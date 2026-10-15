import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Pool } from "pg";
import { createPool } from "../../src/infrastructure/db/client";
import { testControls } from "../../src/infrastructure/testing/controls";
import { contentService } from "../../src/modules/content/service";
import { mediaService } from "../../src/modules/media/service";

let pool: Pool, actorId: string, tagId: string;
const secret = process.env.SESSION_SECRET!;
function service(extra: Partial<Parameters<typeof contentService>[0]> = {}) {
  return contentService({ pool, secret, media: mediaService({ pool, secret, root: process.env.MEDIA_ROOT! }), ...extra });
}
async function draft() { return (await service().createDraft({ actorId, idempotencyKey: randomUUID(), title: "事务文章", markdown: "第一份正文", tagIds: [tagId] })).draft; }
function command(articleId: string) { return { actorId, articleId, stateVersion: 1, draftVersion: 1, idempotencyKey: randomUUID() }; }
function gate() { let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; }); return { wait, release }; }
test.beforeAll(async () => {
  pool = createPool(process.env.DATABASE_URL!, process.env.DATABASE_SCHEMA!); actorId = randomUUID(); tagId = randomUUID();
  await pool.query("INSERT INTO users (id,email_normalized,password_hash,nickname) VALUES ($1,$2,'unusable:publication-fixture','发布作者')", [actorId, `${actorId}@example.test`]);
  await pool.query("INSERT INTO tags (id,slug,name) VALUES ($1,$2,'发布事务标签')", [tagId, `b3-${tagId}`]);
});
test.afterAll(async () => { await pool?.end(); });

test("B3 TXN-01 publishing rolls back content, references, state, event and receipt at both fault points", async () => {
  for (const point of ["content.after-references", "content.after-event"]) {
    const created = await draft(), input = command(created.articleId), controls = testControls(); controls.failOnce(point);
    await expect(service({ faults: controls }).publish(input)).rejects.toMatchObject({ code: "INJECTED_FAILURE" });
    for (const [table, column] of [["article_publications", "article_id"], ["publication_tags", "article_id"], ["publication_media", "article_id"]]) expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column}=$1`, [created.articleId])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT status,state_version FROM articles WHERE id=$1", [created.articleId])).rows[0]).toEqual({ status: "draft", state_version: 1 });
    expect((await pool.query("SELECT 1 FROM domain_events WHERE payload->>'articleId'=$1", [created.articleId])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM idempotency_keys WHERE key=$1", [input.idempotencyKey])).rowCount).toBe(0);
    expect((await service().publish(input)).stateVersion).toBe(2);
    await service().saveDraft({ actorId, articleId: created.articleId, idempotencyKey: randomUUID(), baseDraftVersion: 1, title: "更新内容", markdown: "失败更新不能公开", summary: "" });
    const updating = { ...command(created.articleId), stateVersion: 2, draftVersion: 2 };
    controls.failOnce(point); await expect(service({ faults: controls }).publish(updating)).rejects.toMatchObject({ code: "INJECTED_FAILURE" });
    expect((await service().loadPublic(created.articleId)).markdown).toBe("第一份正文");
    expect((await pool.query("SELECT state_version FROM articles WHERE id=$1", [created.articleId])).rows[0].state_version).toBe(2);
    expect((await pool.query("SELECT count(*)::int AS n FROM domain_events WHERE payload->>'articleId'=$1", [created.articleId])).rows[0].n).toBe(1);
  }
});
test("B3 ARTICLE-01 concurrent identical publish and response-loss replay create one publication and event", async () => {
  const created = await draft(), input = command(created.articleId);
  const entered = gate(), resume = gate();
  const first = service({ hooks: { afterArticleLock: async () => { entered.release(); await resume.wait; } } }).publish(input);
  await entered.wait;
  const second = service().publish(input); resume.release();
  const [one, two] = await Promise.all([first, second]); expect(one.stateVersion).toBe(2); expect(two).toEqual({ ...one, replayed: true });
  expect(await service().publish(input)).toEqual(two);
  expect((await pool.query("SELECT count(*)::int AS n FROM domain_events WHERE payload->>'articleId'=$1", [created.articleId])).rows[0].n).toBe(1);
});
test("B3 EDIT-03 publishing holds the confirmed version while a later draft save remains private", async () => {
  const created = await draft(), entered = gate(), resume = gate();
  const first = service({ hooks: { afterArticleLock: async () => { entered.release(); await resume.wait; } } }).publish(command(created.articleId));
  await entered.wait;
  const later = service().saveDraft({ actorId, articleId: created.articleId, idempotencyKey: randomUUID(), baseDraftVersion: 1, title: "后续私有标题", markdown: "后续私有正文", summary: "" });
  resume.release(); await Promise.all([first, later]);
  expect((await service().loadPublic(created.articleId)).markdown).toBe("第一份正文");
  expect((await service().loadDraft({ viewerId: actorId, articleId: created.articleId })).markdown).toBe("后续私有正文");
  await expect(service().publish({ ...command(created.articleId), stateVersion: 2 })).rejects.toMatchObject({ code: "DRAFT_VERSION_CONFLICT" });
});
test("B3 ARTICLE-01 publish and delete using the same state version cannot both succeed", async () => {
  const created = await draft(), entered = gate(), resume = gate();
  const publishing = service({ hooks: { afterArticleLock: async () => { entered.release(); await resume.wait; } } }).publish(command(created.articleId));
  await entered.wait;
  const deletion = service().deleteArticle({ actorId, articleId: created.articleId, stateVersion: 1, idempotencyKey: randomUUID() });
  // Attach rejection handling before the first transaction releases its locks.
  const result = Promise.allSettled([publishing, deletion]); resume.release();
  const outcomes = await result; expect(outcomes[0].status).toBe("fulfilled"); expect(outcomes[1]).toMatchObject({ status: "rejected", reason: { code: "ARTICLE_STATE_CONFLICT" } });
  const key = randomUUID(); await service().deleteArticle({ actorId, articleId: created.articleId, stateVersion: 2, idempotencyKey: key });
  await expect(service().publish({ ...command(created.articleId), stateVersion: 3 })).rejects.toMatchObject({ code: "ARTICLE_STATE_CONFLICT" });
});
test("B3 REVIEW-02 deletion atomically terminates pending review and a failed transaction preserves it", async () => {
  const created = await draft();
  await service().publish(command(created.articleId));
  await pool.query("UPDATE articles SET status='taken_down',state_version=3,takedown_reason='测试下架' WHERE id=$1", [created.articleId]);
  const review = (await pool.query("INSERT INTO review_requests (article_id,source_draft_version,title,markdown,submitted_by) VALUES ($1,1,'送审','送审正文',$2) RETURNING id", [created.articleId, actorId])).rows[0].id;
  const controls = testControls(); controls.failOnce("content.after-event");
  const input = { actorId, articleId: created.articleId, stateVersion: 3, idempotencyKey: randomUUID() };
  await expect(service({ faults: controls }).deleteArticle(input)).rejects.toMatchObject({ code: "INJECTED_FAILURE" });
  expect((await pool.query("SELECT status FROM review_requests WHERE id=$1", [review])).rows[0].status).toBe("pending");
  const deleted = await service().deleteArticle(input); expect(deleted.stateVersion).toBe(4);
  expect((await pool.query("SELECT status,version FROM review_requests WHERE id=$1", [review])).rows[0]).toEqual({ status: "terminated", version: 2 });
  expect((await service().deleteArticle(input)).replayed).toBe(true);
  await expect(pool.query("UPDATE articles SET status='published',state_version=5 WHERE id=$1", [created.articleId])).rejects.toMatchObject({ code: "23514" });
});

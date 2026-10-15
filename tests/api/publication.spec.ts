import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { Pool } from "pg";
import { createPool } from "../../src/infrastructure/db/client";
import { apiAccount, apiHeaders, type ApiAccount } from "../fixtures/api-account";
import { pngBytes } from "../fixtures/images";

let pool: Pool, author: ApiAccount, other: ApiAccount, guest: APIRequestContext, tags: string[];
test.beforeAll(async ({ playwright, baseURL }) => {
  pool = createPool(process.env.DATABASE_URL!, process.env.DATABASE_SCHEMA!);
  author = await apiAccount(playwright, baseURL!, "公开作者"); other = await apiAccount(playwright, baseURL!, "公开旁观");
  guest = await playwright.request.newContext({ baseURL }); tags = [];
  for (const name of ["可用标签一", "可用标签二", "可用标签三", "已停用标签"]) {
    const id = randomUUID(); tags.push(id); await pool.query("INSERT INTO tags (id,slug,name,enabled) VALUES ($1,$2,$3,$4)", [id, `b3-${id}`, name, name !== "已停用标签"]);
  }
});
test.afterAll(async () => { await author?.context.dispose(); await other?.context.dispose(); await guest?.dispose(); await pool?.end(); });
async function draft(patch: Record<string, unknown> = {}) {
  const response = await author.context.post("/api/v1/articles", { headers: apiHeaders(author), data: { title: "公开文章", markdown: "## 正文\n\n已确认的公开文字。", summary: "可编辑摘要", tagIds: [tags[0]], ...patch } });
  expect(response.status()).toBe(200); return (await response.json()).data.draft as { articleId: string; version: number; stateVersion: number; title: string; markdown: string; summary: string; tagIds: string[] };
}
async function publish(articleId: string, stateVersion = 1, draftVersion = 1, account = author, key = randomUUID()) {
  return account.context.post(`/api/v1/articles/${articleId}/publish`, { headers: apiHeaders(account, key), data: { stateVersion, draftVersion } });
}
async function save(value: Awaited<ReturnType<typeof draft>>, patch: Record<string, unknown> = {}) {
  const response = await author.context.patch(`/api/v1/articles/${value.articleId}/draft`, { headers: apiHeaders(author), data: { title: value.title, markdown: value.markdown, summary: value.summary, tagIds: value.tagIds, baseDraftVersion: value.version, ...patch } });
  expect(response.status()).toBe(200); return (await response.json()).data.draft as typeof value;
}

test("B3 ARTICLE-01 OUTPUT-01 only confirmed publications reach public DTO, HTML, metadata and sitemap", async () => {
  const created = await draft();
  expect((await guest.get(`/api/v1/articles/${created.articleId}`)).status()).toBe(404);
  const key = randomUUID(); const first = await publish(created.articleId, 1, 1, author, key); expect(first.status()).toBe(200);
  expect((await (await publish(created.articleId, 1, 1, author, key)).json()).data).toEqual({ ...(await first.json()).data, replayed: true });
  const original = (await (await guest.get(`/api/v1/articles/${created.articleId}`)).json()).data.article;
  expect(Object.keys(original).sort()).toEqual(["author", "firstPublishedAt", "id", "markdown", "summary", "tags", "title", "updatedAt"].sort());
  expect(Object.keys(original.author).sort()).toEqual(["id", "nickname"]); expect(original.tags[0].id).toBe(tags[0]);
  const changed = await save(created, { title: "私有修订标题", markdown: "私有修订正文不会泄露", summary: "私有摘要" });
  const publicBefore = (await (await guest.get(`/api/v1/articles/${created.articleId}`)).json()).data.article;
  expect(publicBefore).toEqual(original);
  const html = await guest.get(`/articles/${created.articleId}`);
  expect(html.status()).toBe(200); expect(html.headers()["cache-control"]).toMatch(/no-store/);
  expect(await html.text()).toContain("已确认的公开文字"); expect(await html.text()).toContain('content="可编辑摘要"');
  for (const secret of ["私有修订标题", "私有修订正文不会泄露", "私有摘要", "email_normalized", "password_hash"]) expect(await html.text()).not.toContain(secret);
  expect(await (await guest.get("/sitemap.xml")).text()).toContain(`/articles/${created.articleId}`);
  expect((await publish(created.articleId, 2, 1)).status()).toBe(409);
  expect((await publish(created.articleId, 1, changed.version)).status()).toBe(409);
  expect((await publish(created.articleId, 2, changed.version)).status()).toBe(200);
  const revised = (await (await guest.get(`/api/v1/articles/${created.articleId}`)).json()).data.article;
  expect(revised.id).toBe(original.id); expect(revised.firstPublishedAt).toBe(original.firstPublishedAt); expect(revised.markdown).toBe(changed.markdown); expect(revised.updatedAt >= original.updatedAt).toBe(true);
});
test("B3 ARTICLE-01 publishing validates content, tag count, disabled tags and controlled image references", async () => {
  for (const patch of [{ title: " \n " }, { markdown: "\n\t " }, { tagIds: [] }, { tagIds: [tags[3]] }, { markdown: "![外部](https://example.test/a.png)" }, { markdown: "![临时](blob:anything)" }, { markdown: "![引用][img]\n\n[img]: https://example.test/a.png" }]) {
    const created = await draft(patch); expect((await publish(created.articleId)).status()).toBe(400);
    expect((await guest.get(`/api/v1/articles/${created.articleId}`)).status()).toBe(404);
  }
  expect((await author.context.post("/api/v1/articles", { headers: apiHeaders(author), data: { tagIds: tags } })).status()).toBe(400);
  expect((await author.context.post("/api/v1/articles", { headers: apiHeaders(author), data: { tagIds: [tags[0], tags[0]] } })).status()).toBe(400);
  const unicode = await draft({ title: "😀".repeat(100), summary: "😀".repeat(200), tagIds: tags.slice(0, 3) }); expect((await publish(unicode.articleId)).status()).toBe(200);
  const automatic = await draft({ summary: "", markdown: "## 标题\n\n**纯文字摘要**" }); expect((await publish(automatic.articleId)).status()).toBe(200);
  expect((await (await guest.get(`/api/v1/articles/${automatic.articleId}`)).json()).data.article.summary).toBe("标题 纯文字摘要");
});
test("B3 MEDIA-01 MEDIA-02 publishing rechecks media and deletion immediately revokes guest reads", async () => {
  const upload = await author.context.post("/api/v1/media", { headers: { ...apiHeaders(author), "Content-Type": "image/png" }, data: pngBytes(6, 4) });
  expect(upload.status()).toBe(200); const mediaId = (await upload.json()).data.media.id;
  const created = await draft({ markdown: `正文\n\n![站内图片](/api/v1/media/${mediaId})` });
  expect((await guest.get(`/api/v1/media/${mediaId}`)).status()).toBe(404);
  expect((await publish(created.articleId)).status()).toBe(200); expect((await guest.get(`/api/v1/media/${mediaId}`)).status()).toBe(200);
  const shared = await draft({ markdown: `另一篇文章 ![同一图片](/api/v1/media/${mediaId})` }); expect((await publish(shared.articleId)).status()).toBe(200);
  const deleted = await author.context.delete(`/api/v1/articles/${created.articleId}`, { headers: apiHeaders(author), data: { stateVersion: 2 } }); expect(deleted.status()).toBe(200);
  expect((await guest.get(`/api/v1/media/${mediaId}`)).status()).toBe(200);
  expect((await author.context.delete(`/api/v1/articles/${shared.articleId}`, { headers: apiHeaders(author), data: { stateVersion: 2 } })).status()).toBe(200);
  expect((await guest.get(`/api/v1/media/${mediaId}`)).status()).toBe(404); expect((await author.context.get(`/api/v1/media/${mediaId}`)).status()).toBe(200);
  expect((await guest.get(`/api/v1/articles/${created.articleId}`)).status()).toBe(404); expect((await author.context.get(`/api/v1/articles/${created.articleId}/draft`)).status()).toBe(404);
  const html = await (await guest.get(`/articles/${created.articleId}`)).text(); expect(html).not.toContain(mediaId);
  expect(await (await guest.get("/sitemap.xml")).text()).not.toContain(`/articles/${created.articleId}`);
  expect((await pool.query("SELECT status FROM articles WHERE id=$1", [created.articleId])).rows[0].status).toBe("deleted");

  const unready = randomUUID(); await pool.query("INSERT INTO media (id,owner_id,storage_key,mime,size,status,upload_lease_until) VALUES ($1,$2,$3,'image/png',32,'staging',now()+interval '1 minute')", [unready, author.id, `${author.id}/${unready}.png`]);
  // Corrupt-reference fixture: publish must validate afresh, independently of earlier save checks.
  const invalid = await draft(); await pool.query("UPDATE article_drafts SET markdown=$2,version=version+1 WHERE article_id=$1", [invalid.articleId, `![图](/api/v1/media/${unready})`]);
  expect((await publish(invalid.articleId, 1, 2)).status()).toBe(409);
  await pool.query("UPDATE media SET owner_id=$2 WHERE id=$1", [unready, other.id]); expect((await publish(invalid.articleId, 1, 2)).status()).toBe(403);
});
test("B3 SECURITY-01 author-only writes check current ban, CSRF and exact Origin including successful replays", async () => {
  const created = await draft();
  for (const method of ["publish", "delete"]) {
    const url = `/api/v1/articles/${created.articleId}${method === "publish" ? "/publish" : ""}`;
    const data = method === "publish" ? { stateVersion: 1, draftVersion: 1 } : { stateVersion: 1 };
    const send = (context: APIRequestContext, headers: Record<string, string>) => method === "publish" ? context.post(url, { headers, data }) : context.delete(url, { headers, data });
    expect((await send(guest, { Origin: author.origin })).status()).toBe(401);
    expect((await send(other.context, apiHeaders(other))).status()).toBe(404);
    await pool.query("UPDATE users SET role='admin' WHERE id=$1", [other.id]); expect((await send(other.context, apiHeaders(other))).status()).toBe(404);
    expect((await send(author.context, { ...apiHeaders(author), "X-CSRF-Token": "wrong" })).status()).toBe(403);
    expect((await send(author.context, { ...apiHeaders(author), Origin: "https://foreign.test" })).status()).toBe(403);
  }
  const key = randomUUID(); expect((await publish(created.articleId, 1, 1, author, key)).status()).toBe(200);
  await pool.query("UPDATE users SET status='banned' WHERE id=$1", [author.id]);
  try {
    expect((await publish(created.articleId, 1, 1, author, key)).status()).toBe(403);
    expect((await author.context.delete(`/api/v1/articles/${created.articleId}`, { headers: apiHeaders(author), data: { stateVersion: 2 } })).status()).toBe(403);
    expect((await author.context.get("/api/v1/me/articles")).status()).toBe(200);
  } finally { await pool.query("UPDATE users SET status='normal' WHERE id=$1", [author.id]); }
});
test("B3 ARTICLE-01 deletion replay is stable, stale states fail and taken-down content cannot bypass review", async () => {
  const created = await draft(); await publish(created.articleId);
  const stale = await author.context.delete(`/api/v1/articles/${created.articleId}`, { headers: apiHeaders(author), data: { stateVersion: 1 } }); expect(stale.status()).toBe(409);
  await pool.query("UPDATE articles SET status='taken_down',state_version=3,takedown_reason='自动化边界数据' WHERE id=$1", [created.articleId]);
  expect((await publish(created.articleId, 3, 1)).status()).toBe(409); expect((await guest.get(`/api/v1/articles/${created.articleId}`)).status()).toBe(404);
  const key = randomUUID(), data = { stateVersion: 3 }, url = `/api/v1/articles/${created.articleId}`;
  expect((await author.context.delete(url, { headers: apiHeaders(author, key), data })).status()).toBe(200);
  const replay = (await (await author.context.delete(url, { headers: apiHeaders(author, key), data })).json()).data; expect(replay).toEqual({ articleId: created.articleId, stateVersion: 4, replayed: true });
  expect((await publish(created.articleId, 4, 1)).status()).toBe(409);
  expect((await author.context.patch(`${url}/draft`, { headers: apiHeaders(author), data: { title: "不能复活", markdown: "不能复活", summary: "", baseDraftVersion: 1 } })).status()).toBe(409);
});
test("B3 content management is private, paginated and marks unpublished revisions and takedown reasons", async () => {
  const created = await draft(); await publish(created.articleId); await save(created, { markdown: "工作草稿新版本" });
  const all = (await (await author.context.get("/api/v1/me/articles?status=published&limit=1")).json()).data;
  expect(all.items[0]).toMatchObject({ id: created.articleId, hasUnpublishedChanges: true, draftVersion: 2, stateVersion: 2 });
  const tied = await Promise.all([draft(), draft(), draft()]);
  await pool.query("UPDATE articles SET created_at='2026-10-15T00:00:00.123456Z' WHERE id=ANY($1::uuid[])", [tied.map((item) => item.articleId)]);
  const seen = new Set<string>(); let cursor: string | null = null;
  do {
    const page: { items: { id: string }[]; nextCursor: string | null } = (await (await author.context.get(`/api/v1/me/articles?limit=2${cursor ? `&cursor=${cursor}` : ""}`)).json()).data;
    for (const item of page.items) { expect(seen.has(item.id)).toBe(false); seen.add(item.id); }
    cursor = page.nextCursor;
  } while (cursor);
  expect(seen.has(created.articleId)).toBe(true);
  const expected = (await pool.query("SELECT id FROM articles WHERE author_id=$1 AND status<>'deleted'", [author.id])).rows.map((item: { id: string }) => item.id).sort();
  expect([...seen].sort()).toEqual(expected);
  expect((await guest.get("/api/v1/me/articles")).status()).toBe(401);
  expect((await (await other.context.get("/api/v1/me/articles")).json()).data.items).toEqual([]);
  expect((await author.context.get("/api/v1/me/articles?cursor=bad")).status()).toBe(400);
  await pool.query("UPDATE articles SET status='taken_down',state_version=3,takedown_reason='展示下架原因' WHERE id=$1", [created.articleId]);
  expect((await (await author.context.get("/api/v1/me/articles?status=taken_down")).json()).data.items.find((item: { id: string }) => item.id === created.articleId)).toMatchObject({ takedownReason: "展示下架原因" });
  // Disabled tags remain visible on existing publications, while new publishing rejects them.
  const existing = await draft(); await publish(existing.articleId); await pool.query("UPDATE tags SET enabled=false WHERE id=$1", [tags[0]]);
  try { expect((await (await guest.get(`/api/v1/articles/${existing.articleId}`)).json()).data.article.tags[0].id).toBe(tags[0]); expect((await publish(existing.articleId, 2, 1)).status()).toBe(400); }
  finally { await pool.query("UPDATE tags SET enabled=true WHERE id=$1", [tags[0]]); }
});

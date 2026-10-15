import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Pool } from "pg";
import { createPool } from "../../src/infrastructure/db/client";
import { migrateDatabase } from "../../src/infrastructure/db/migrate";
import { withTransaction, type Transaction } from "../../src/infrastructure/db/transaction";
import { withIdempotency, requireWritableActor } from "../../src/modules/foundation/idempotency";
import { enqueueEvent, claimJobs, applyJobEffect, completeJob, failJob, retryFailedJob, renewLease, jobSettings } from "../../src/modules/jobs/service";
import { testControls } from "../../src/infrastructure/testing/controls";
import { createTestRun, cleanupTestRun } from "../../src/infrastructure/testing/run";

let pool: Pool;
const secret = "test-only-request-hmac-key".padEnd(64, "x");
test.beforeAll(() => {
  if (process.env.DATABASE_SCHEMA !== `bbtest_${process.env.TEST_RUN_ID}`) throw new Error("Foundation tests require an isolated namespace.");
  pool = createPool(process.env.DATABASE_URL!, process.env.DATABASE_SCHEMA);
});
test.afterAll(async () => { await pool?.end(); });

async function author() {
  const userId = randomUUID();
  await pool.query("INSERT INTO users (id,email_normalized,password_hash,nickname) VALUES ($1,$2,'unusable:test-fixture','测试作者')", [userId, `${userId}@example.test`]);
  return userId;
}
async function article(tx: Transaction, authorId: string) {
  const articleId = randomUUID();
  await tx.client.query("INSERT INTO articles (id,author_id) VALUES ($1,$2)", [articleId, authorId]);
  await tx.client.query("INSERT INTO article_drafts (article_id,title,markdown) VALUES ($1,'草稿','正文')", [articleId]);
  return articleId;
}
function command(actorId: string, key = randomUUID(), request = { title: "固定输入" }) {
  return { actorId, operation: "article.create", key, request, hashSecret: secret, authorize: (tx: Transaction) => requireWritableActor(tx, actorId) };
}
function gate() { let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; }); return { wait, release }; }

test("ENV-01 migrations are repeatable and foreign keys stay inside the run", async () => {
  await migrateDatabase(pool, process.env.DATABASE_SCHEMA);
  const migrations = await pool.query("SELECT count(*)::int AS count FROM __drizzle_migrations");
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  expect(migrations.rows[0].count).toBe(journal.entries.length);
  const foreignKeys = await pool.query(`SELECT count(*)::int AS count FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace a ON a.oid=child.relnamespace JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace b ON b.oid=parent.relnamespace WHERE c.contype='f' AND a.nspname=$1 AND b.nspname<>$1`, [process.env.DATABASE_SCHEMA]);
  expect(foreignKeys.rows[0].count).toBe(0);
  const original = (await pool.query("SELECT id,hash FROM __drizzle_migrations ORDER BY id LIMIT 1")).rows[0];
  try {
    await pool.query("UPDATE __drizzle_migrations SET hash='changed-history' WHERE id=$1", [original.id]);
    await expect(migrateDatabase(pool, process.env.DATABASE_SCHEMA)).rejects.toThrow("history differs");
  } finally { await pool.query("UPDATE __drizzle_migrations SET hash=$2 WHERE id=$1", [original.id, original.hash]); }
});

test("ENV-01 independent runs cannot consume each other's tasks and cleanup rejects a changed identity", async () => {
  const other = await createTestRun(process.env.DATABASE_URL!);
  const otherPool = createPool(process.env.DATABASE_URL!, other.schema);
  try {
    const eventId = await withTransaction(otherPool, (tx) => enqueueEvent(tx, { type: "system.probe", payload: {}, handlers: ["system.probe"] }));
    expect((await claimJobs(pool)).some((job) => job.event_id === eventId)).toBe(false);
    await expect(cleanupTestRun(process.env.DATABASE_URL!, { ...other, schema: "public" })).rejects.toThrow("identity mismatch");
    await expect(cleanupTestRun(process.env.DATABASE_URL!, { ...other, media: path.resolve(".local") })).rejects.toThrow("path mismatch");
    expect((await otherPool.query("SELECT count(*)::int AS count FROM jobs")).rows[0].count).toBe(1);
  } finally { await otherPool.end(); await cleanupTestRun(process.env.DATABASE_URL!, other); }
  await cleanupTestRun(process.env.DATABASE_URL!, other);
  expect((await pool.query("SELECT to_regclass($1) AS name", [`${other.schema}.jobs`])).rows[0].name).toBeNull();
});

test("TXN-01 business, relationship, audit and event writes roll back together", async () => {
  const userId = await author();
  const controls = testControls();
  controls.failOnce("after-event");
  let articleId = "";
  await expect(withTransaction(pool, async (tx) => {
    articleId = await article(tx, userId);
    const tag = await tx.client.query("INSERT INTO tags (slug,name) VALUES ($1,'事务测试') RETURNING id", [`txn-${articleId}`]);
    await tx.client.query("INSERT INTO draft_tags VALUES ($1,$2)", [articleId, tag.rows[0].id]);
    await tx.client.query("INSERT INTO audit_logs (actor_id,target_type,target_id,action,reason,request_id) VALUES ($1,'article',$2,'test.create','事务验证',$3)", [userId, articleId, randomUUID()]);
    await enqueueEvent(tx, { type: "system.probe", payload: { articleId }, handlers: ["system.probe"] });
    controls.hit("after-event");
  })).rejects.toMatchObject({ code: "INJECTED_FAILURE" });
  for (const [table, field] of [["articles", "id"], ["draft_tags", "article_id"], ["audit_logs", "target_id"]]) {
    expect((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${field}=$1`, [articleId])).rows[0].count).toBe(0);
  }
  expect((await pool.query("SELECT count(*)::int AS count FROM domain_events WHERE payload->>'articleId'=$1", [articleId])).rows[0].count).toBe(0);
});

test("TXN-01 concurrent identical submissions and response-loss replay create one article/event", async () => {
  const userId = await author();
  const input = command(userId);
  const entered = gate(); const unblock = gate(); const secondStarted = gate();
  let executions = 0;
  const first = withTransaction(pool, (tx) => withIdempotency(tx, input, async () => {
    executions++; const id = await article(tx, userId);
    await enqueueEvent(tx, { type: "system.probe", payload: { articleId: id }, handlers: ["system.probe"] });
    entered.release(); await unblock.wait;
    return { resourceId: id, version: 1 };
  }));
  await entered.wait;
  const second = withTransaction(pool, (tx) => { secondStarted.release(); return withIdempotency(tx, input, async () => { throw new Error("duplicate work executed"); }); });
  await secondStarted.wait; unblock.release();
  const [one, two] = await Promise.all([first, second]);
  expect(one.receipt).toEqual(two.receipt);
  expect(two.replayed).toBe(true);
  expect(executions).toBe(1);
  const replay = await withTransaction(pool, (tx) => withIdempotency(tx, input, async () => { throw new Error("lost-response retry executed twice"); }));
  expect(replay.receipt).toEqual(one.receipt);
  expect((await pool.query("SELECT count(*)::int AS count FROM domain_events WHERE payload->>'articleId'=$1", [one.receipt.resourceId])).rows[0].count).toBe(1);
  const job = (await claimJobs(pool)).find((item) => item.payload.articleId === one.receipt.resourceId)!;
  await applyJobEffect(pool, job, async () => {});
  await completeJob(pool, job);
});

test("TXN-01 failed submissions leave no completed key; changed payload conflicts; replay rechecks ban", async () => {
  const userId = await author(); const input = command(userId);
  await expect(withTransaction(pool, (tx) => withIdempotency(tx, input, async () => { await article(tx, userId); throw new Error("controlled rollback"); }))).rejects.toThrow("controlled rollback");
  expect((await pool.query("SELECT count(*)::int AS count FROM idempotency_keys WHERE actor_id=$1", [userId])).rows[0].count).toBe(0);
  await withTransaction(pool, (tx) => withIdempotency(tx, input, async () => ({ resourceId: await article(tx, userId) })));
  await expect(withTransaction(pool, (tx) => withIdempotency(tx, { ...input, request: { title: "changed" } }, async () => ({ resourceId: randomUUID() })))).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  await pool.query("UPDATE users SET status='banned' WHERE id=$1", [userId]);
  await expect(withTransaction(pool, (tx) => withIdempotency(tx, input, async () => ({ resourceId: randomUUID() })))).rejects.toMatchObject({ code: "ACCOUNT_BANNED", status: 403 });
});

test("ARTICLE-01 / REVIEW-01 schema separates content and protects immutable snapshots and references", async () => {
  const userId = await author();
  const reviewId = randomUUID();
  const articleId = await withTransaction(pool, async (tx) => {
    const id = await article(tx, userId);
    const tag = await tx.client.query("INSERT INTO tags (slug,name) VALUES ($1,'快照测试') RETURNING id", [`review-${reviewId}`]);
    await tx.client.query("INSERT INTO article_publications (article_id,source_draft_version,title,markdown,plain_text) VALUES ($1,1,'公开','公开正文','公开正文')", [id]);
    await tx.client.query("INSERT INTO review_requests (id,article_id,source_draft_version,title,markdown,submitted_by) VALUES ($1,$2,1,'送审','送审正文',$3)", [reviewId, id, userId]);
    await tx.client.query("INSERT INTO review_tags VALUES ($1,$2)", [reviewId, tag.rows[0].id]);
    return id;
  });
  await pool.query("UPDATE article_drafts SET markdown='后续私有修改',version=version+1 WHERE article_id=$1", [articleId]);
  expect((await pool.query("SELECT markdown FROM article_publications WHERE article_id=$1", [articleId])).rows[0].markdown).toBe("公开正文");
  expect((await pool.query("SELECT markdown FROM review_requests WHERE id=$1", [reviewId])).rows[0].markdown).toBe("送审正文");
  await expect(pool.query("UPDATE review_requests SET markdown='changed' WHERE id=$1", [reviewId])).rejects.toMatchObject({ code: "23514" });
  await expect(pool.query("DELETE FROM review_tags WHERE review_id=$1", [reviewId])).rejects.toMatchObject({ code: "42501" });
  const laterTag = await pool.query("INSERT INTO tags (slug,name) VALUES ($1,'后来标签') RETURNING id", [`later-${reviewId}`]);
  await expect(pool.query("INSERT INTO review_tags VALUES ($1,$2)", [reviewId, laterTag.rows[0].id])).rejects.toMatchObject({ code: "23514" });
  await expect(pool.query("INSERT INTO review_requests (article_id,source_draft_version,title,markdown,submitted_by) VALUES ($1,2,'另一送审','正文',$2)", [articleId, userId])).rejects.toMatchObject({ code: "23505" });
});

test("ADMIN-01 audit records cannot be changed or deleted by the application role", async () => {
  const userId = await author(); const id = randomUUID();
  await pool.query("INSERT INTO audit_logs (id,actor_id,target_type,target_id,action,reason,request_id) VALUES ($1,$2,'user',$2,'test.action','测试原因',$3)", [id, userId, randomUUID()]);
  await expect(pool.query("UPDATE audit_logs SET reason='changed' WHERE id=$1", [id])).rejects.toMatchObject({ code: "42501" });
  await expect(pool.query("DELETE FROM audit_logs WHERE id=$1", [id])).rejects.toMatchObject({ code: "42501" });
});

test("TASK-01 two workers cannot claim the same task", async () => {
  const eventId = await withTransaction(pool, (tx) => enqueueEvent(tx, { type: "system.probe", payload: {}, handlers: ["system.probe", "system.probe"] }));
  const [a, b] = await Promise.all([claimJobs(pool), claimJobs(pool)]);
  const matches = [...a, ...b].filter((job) => job.event_id === eventId);
  expect(matches).toHaveLength(1);
  await applyJobEffect(pool, matches[0], async () => {});
  expect(await completeJob(pool, matches[0])).toBe(true);
});

test("TASK-01 retry timing, write-before-ack interruption and stale lease fencing preserve one notification", async () => {
  const userId = await author(); const controls = testControls(new Date(Date.now() + 120_000));
  const eventId = await withTransaction(pool, (tx) => enqueueEvent(tx, { type: "system.probe", payload: { recipientId: userId }, handlers: ["system.probe"] }, controls.clock));
  const first = (await claimJobs(pool, controls.clock)).find((job) => job.event_id === eventId)!;
  expect(await failJob(pool, first, "TEMPORARY_FAILURE", controls.clock)).toBe(true);
  expect((await claimJobs(pool, controls.clock)).some((job) => job.event_id === eventId)).toBe(false);
  controls.advance(5000);
  const second = (await claimJobs(pool, controls.clock)).find((job) => job.event_id === eventId)!;
  expect(second.attempts).toBe(2);
  await applyJobEffect(pool, second, async (tx) => { await tx.client.query("INSERT INTO notifications (recipient_id,event_id,type,target_id) VALUES ($1,$2,'test.reply',$1)", [userId, eventId]); }, controls.clock);
  // Stop before acknowledgement: the effect and durable receipt have committed.
  controls.advance(jobSettings.leaseMs);
  const recovered = (await claimJobs(pool, controls.clock)).find((job) => job.event_id === eventId)!;
  expect(await completeJob(pool, second, controls.clock)).toBe(false);
  expect(await renewLease(pool, second, controls.clock)).toBe(false);
  expect(await failJob(pool, second, "OLD_WORKER", controls.clock)).toBe(false);
  let duplicate = false;
  await applyJobEffect(pool, recovered, async () => { duplicate = true; }, controls.clock);
  expect(duplicate).toBe(false);
  expect(await completeJob(pool, recovered, controls.clock)).toBe(true);
  expect((await pool.query("SELECT count(*)::int AS count FROM notifications WHERE event_id=$1", [eventId])).rows[0].count).toBe(1);
});

test("TASK-01 lease renewal, terminal failure and restricted retry have persistent states", async () => {
  const controls = testControls(new Date(Date.now() + 240_000));
  const eventId = await withTransaction(pool, (tx) => enqueueEvent(tx, { type: "system.probe", payload: {}, handlers: ["system.probe"] }, controls.clock));
  await pool.query("UPDATE jobs SET max_attempts=1 WHERE event_id=$1", [eventId]);
  const job = (await claimJobs(pool, controls.clock)).find((item) => item.event_id === eventId)!;
  controls.advance(30_000); expect(await renewLease(pool, job, controls.clock)).toBe(true);
  controls.advance(30_000); expect((await claimJobs(pool, controls.clock)).some((item) => item.id === job.id)).toBe(false);
  controls.advance(30_000); await claimJobs(pool, controls.clock);
  expect((await pool.query("SELECT status FROM jobs WHERE id=$1", [job.id])).rows[0].status).toBe("failed");
  await retryFailedJob(pool, job.id, controls.clock);
  const retry = (await claimJobs(pool, controls.clock)).find((item) => item.id === job.id)!;
  expect(retry.attempts).toBe(1);
  await applyJobEffect(pool, retry, async () => {}, controls.clock);
  expect(await completeJob(pool, retry, controls.clock)).toBe(true);
});

test("TASK-01 a restarted real worker completes a persisted task", async () => {
  const controls = testControls(new Date(Date.now() - 120_000));
  const eventId = await withTransaction(pool, (tx) => enqueueEvent(tx, { type: "system.probe", payload: {}, handlers: ["system.probe"] }, controls.clock));
  const interrupted = (await claimJobs(pool, controls.clock)).find((job) => job.event_id === eventId)!;
  await applyJobEffect(pool, interrupted, async () => {}, controls.clock);
  // The old process left a committed receipt and an unacknowledged, now-expired lease.
  async function runWorker() {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/worker/index.ts", "--once"], { env: { ...process.env, WORKER_HEARTBEAT: path.join(process.env.MEDIA_ROOT!, "worker.json") }, stdio: "pipe", windowsHide: true });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
      child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Worker exit ${code}: ${output}`)));
    });
  }
  await runWorker(); await runWorker();
  const result = await pool.query("SELECT j.status,j.attempts,count(r.job_id)::int AS receipts FROM jobs j LEFT JOIN job_receipts r ON r.job_id=j.id WHERE j.event_id=$1 GROUP BY j.status,j.attempts", [eventId]);
  expect(result.rows[0]).toEqual({ status: "completed", attempts: 2, receipts: 1 });
});

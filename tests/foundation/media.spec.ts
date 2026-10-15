import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm, rmdir, symlink } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Pool } from "pg";
import { createPool } from "../../src/infrastructure/db/client";
import { withTransaction } from "../../src/infrastructure/db/transaction";
import { hashPassword } from "../../src/infrastructure/password";
import { consumeRateLimits } from "../../src/infrastructure/rate-limit";
import { checksumOf, mediaStore, storageKeyFor } from "../../src/infrastructure/storage/media-store";
import { testControls } from "../../src/infrastructure/testing/controls";
import { mediaPolicy } from "../../src/modules/media/policy";
import { mediaService } from "../../src/modules/media/service";
import { secretToken } from "../../src/modules/identity/security";
import { htmlBytes, paddedPng, pngBytes } from "../fixtures/images";

let pool: Pool;
let owner: string;
let other: string;
const secret = process.env.SESSION_SECRET!;
const root = process.env.MEDIA_ROOT!;
const control = testControls();
const service = () => mediaService({ pool, secret, root, clock: control.clock, faults: control });
const ownerViewer = () => ({ id: owner, role: "user" as const, status: "normal" as const });

async function createUser(nickname: string) {
  const id = randomUUID();
  await pool.query("INSERT INTO users (id,email_normalized,password_hash,nickname) VALUES ($1,$2,$3,$4)", [id, `${id}@example.test`, await hashPassword(secretToken()), nickname]);
  return id;
}
const rowFor = async (id: string) => (await pool.query("SELECT status,checksum,failure_code,storage_key,upload_lease_until FROM media WHERE id=$1", [id])).rows[0];
const countFor = async (userId: string) => (await pool.query("SELECT count(*)::int AS n FROM media WHERE owner_id=$1", [userId])).rows[0].n;

test.beforeAll(async () => {
  pool = createPool(process.env.DATABASE_URL!, process.env.DATABASE_SCHEMA!);
  owner = await createUser("媒体所有者");
  other = await createUser("其他成员");
});
test.afterAll(async () => { await pool?.end(); });

test("B1 a real image upload is stored, verified and readable by its owner only", async () => {
  const bytes = pngBytes(8, 6);
  const uploaded = await service().upload({ actorId: owner, idempotencyKey: randomUUID(), bytes });
  expect(uploaded.replayed).toBe(false);
  expect(uploaded.media).toMatchObject({ mime: "image/png", size: bytes.length, status: "ready" });
  const row = await rowFor(uploaded.media.id);
  expect(row.checksum).toBe(checksumOf(bytes));
  expect(row.upload_lease_until).toBeNull();
  expect((await mediaStore({ root }).read(row.storage_key)).equals(bytes)).toBe(true);
  const read = await service().read({ mediaId: uploaded.media.id, viewer: ownerViewer() });
  expect(read.mime).toBe("image/png");
  expect(read.bytes.equals(bytes)).toBe(true);
  for (const viewer of [null, { id: other, role: "user" as const, status: "normal" as const }]) {
    await expect(service().read({ mediaId: uploaded.media.id, viewer })).rejects.toMatchObject({ code: "MEDIA_NOT_FOUND" });
  }
});

test("B1 forged, empty and oversize uploads create no media record", async () => {
  const before = await countFor(owner);
  await expect(service().upload({ actorId: owner, idempotencyKey: randomUUID(), bytes: htmlBytes })).rejects.toMatchObject({ code: "MEDIA_TYPE_REJECTED" });
  await expect(service().upload({ actorId: owner, idempotencyKey: randomUUID(), bytes: Buffer.alloc(0) })).rejects.toMatchObject({ code: "MEDIA_EMPTY" });
  await expect(service().upload({ actorId: owner, idempotencyKey: randomUUID(), bytes: paddedPng(mediaPolicy.maxBytes + 1) })).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });
  expect(await countFor(owner)).toBe(before);
});

test("B1 a failed upload is recorded as failed and the same key may be retried", async () => {
  control.failOnce("media.write");
  const key = randomUUID();
  await expect(service().upload({ actorId: owner, idempotencyKey: key, bytes: pngBytes() })).rejects.toMatchObject({ code: "MEDIA_UPLOAD_FAILED" });
  const failed = (await pool.query("SELECT id,status,failure_code,checksum FROM media WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1", [owner])).rows[0];
  expect(failed).toMatchObject({ status: "failed", failure_code: "storage_write_failed", checksum: null });
  expect((await mediaStore({ root }).verify((await rowFor(failed.id)).storage_key))).toBeNull();
  const retried = await service().upload({ actorId: owner, idempotencyKey: key, bytes: pngBytes() });
  expect(retried.media.status).toBe("ready");
});

test("B1 a file written without database confirmation is recovered once, never faked", async () => {
  control.failOnce("media.finalize");
  const bytes = pngBytes(5, 5);
  await expect(service().upload({ actorId: owner, idempotencyKey: randomUUID(), bytes })).rejects.toBeTruthy();
  const staged = (await pool.query("SELECT id,status,storage_key FROM media WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1", [owner])).rows[0];
  expect(staged.status).toBe("staging");
  expect((await mediaStore({ root }).read(staged.storage_key)).equals(bytes)).toBe(true);
  control.advance(mediaPolicy.uploadLeaseMs + 1);
  const recovered = await service().recoverStaged();
  expect(recovered.completed).toBeGreaterThanOrEqual(1);
  const row = await rowFor(staged.id);
  expect(row.status).toBe("ready");
  expect(row.checksum).toBe(checksumOf(bytes));
  expect((await service().recoverStaged()).completed).toBe(0);
});

test("B1 unfinished media cannot be referenced and foreign media is refused", async () => {
  control.failOnce("media.finalize");
  await expect(service().upload({ actorId: owner, idempotencyKey: randomUUID(), bytes: pngBytes() })).rejects.toBeTruthy();
  const staging = (await pool.query("SELECT id FROM media WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1", [owner])).rows[0].id;
  await expect(withTransaction(pool, (tx) => service().validateReferences(tx, owner, [staging]))).rejects.toMatchObject({ code: "MEDIA_NOT_READY" });
  const foreign = await service().upload({ actorId: other, idempotencyKey: randomUUID(), bytes: pngBytes() });
  await expect(withTransaction(pool, (tx) => service().validateReferences(tx, owner, [foreign.media.id]))).rejects.toMatchObject({ code: "MEDIA_FORBIDDEN" });
  await expect(withTransaction(pool, (tx) => service().validateReferences(tx, owner, [randomUUID()]))).rejects.toMatchObject({ code: "MEDIA_NOT_FOUND" });
  const own = await service().upload({ actorId: owner, idempotencyKey: randomUUID(), bytes: pngBytes() });
  await withTransaction(pool, (tx) => service().validateReferences(tx, owner, [own.media.id]));
});

test("B1 the same upload key replays one ready media and concurrent retries stay single", async () => {
  const bytes = pngBytes(6, 4);
  const key = randomUUID();
  const first = await service().upload({ actorId: owner, idempotencyKey: key, bytes });
  const replay = await service().upload({ actorId: owner, idempotencyKey: key, bytes });
  expect(replay.replayed).toBe(true);
  expect(replay.media.id).toBe(first.media.id);
  await expect(service().upload({ actorId: owner, idempotencyKey: key, bytes: pngBytes(9, 9) })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  const concurrentKey = randomUUID();
  const results = await Promise.allSettled([
    service().upload({ actorId: owner, idempotencyKey: concurrentKey, bytes }),
    service().upload({ actorId: owner, idempotencyKey: concurrentKey, bytes }),
  ]);
  const ids = new Set(results.map((result) => result.status === "fulfilled" ? result.value.media.id : "rejected"));
  expect(ids.size).toBe(1);
  const ready = await pool.query("SELECT count(*)::int AS n FROM media WHERE id=$1 AND status='ready'", [first.media.id]);
  expect(ready.rows[0].n).toBe(1);
});

test("B1 storage keys cannot escape the media root through traversal or junctions", async () => {
  const outside = path.join(path.dirname(root), `outside-${randomUUID()}`);
  await mkdir(outside, { recursive: true });
  const victim = randomUUID();
  const junction = path.join(root, victim);
  await symlink(outside, junction, "junction");
  try {
    await expect(mediaStore({ root }).read(storageKeyFor(victim, randomUUID(), "png"))).rejects.toMatchObject({ code: "INVALID_MEDIA_KEY" });
  } finally {
    await rm(junction, { force: true }).catch(() => rmdir(junction).catch(() => {}));
    await rm(outside, { recursive: true, force: true });
  }
  for (const key of ["../../etc/passwd", "/etc/passwd", `${victim}/../${randomUUID()}.png`]) {
    await expect(mediaStore({ root }).read(key)).rejects.toMatchObject({ code: "INVALID_MEDIA_KEY" });
  }
});

test("B1 a stored image is readable from a separate process", async () => {
  const bytes = pngBytes(7, 7);
  const uploaded = await service().upload({ actorId: owner, idempotencyKey: randomUUID(), bytes });
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/media.mjs", "verify", uploaded.media.id], { env: process.env, stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (part) => { stdout += String(part); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`media verify exited with ${code}`)));
  });
  const parsed = JSON.parse(output.trim().split("\n").at(-1)!) as Record<string, unknown>;
  expect(parsed).toMatchObject({ id: uploaded.media.id, status: "ready", databaseChecksum: checksumOf(bytes), databaseSize: bytes.length, fileChecksum: checksumOf(bytes), fileSize: bytes.length, fileMime: "image/png" });
});

test("B1 upload rate limit applies per owner while replays stay available", async () => {
  const key = randomUUID(); const bytes = pngBytes(3, 5);
  const first = await service().upload({ actorId: other, idempotencyKey: key, bytes });
  for (let attempt = 0; attempt < mediaPolicy.limits.upload.count; attempt++) {
    await consumeRateLimits(pool, secret, control.clock, [{ name: "media.upload.owner", subject: other, ...mediaPolicy.limits.upload }]).catch(() => {});
  }
  await expect(service().upload({ actorId: other, idempotencyKey: randomUUID(), bytes: pngBytes() })).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  const replay = await service().upload({ actorId: other, idempotencyKey: key, bytes });
  expect(replay.replayed).toBe(true);
  expect(replay.media.id).toBe(first.media.id);
});

test("B1 cleanup removes only unreferenced artifacts past the grace period", async () => {
  // 清理会扫描整个存储根，并用推进后的时钟判断宽限期；本用例使用独立根目录，
  // 避免删除同轮其他用例刚刚上传、尚未建立引用的真实图片。
  const scope = path.join(root, `cleanup-scope-${randomUUID()}`);
  await mkdir(scope, { recursive: true });
  const scoped = () => mediaService({ pool, secret, root: scope, clock: control.clock, faults: control });
  try {
    const unreferenced = await scoped().upload({ actorId: owner, idempotencyKey: randomUUID(), bytes: pngBytes(4, 4) });
    const referenced = await scoped().upload({ actorId: owner, idempotencyKey: randomUUID(), bytes: pngBytes(4, 5) });
    const articleId = randomUUID();
    await pool.query("INSERT INTO articles (id,author_id) VALUES ($1,$2)", [articleId, owner]);
    await pool.query("INSERT INTO article_drafts (article_id,version,title,markdown,summary) VALUES ($1,1,'草稿','正文','摘要')", [articleId]);
    await pool.query("INSERT INTO draft_media (article_id,media_id) VALUES ($1,$2)", [articleId, referenced.media.id]);
    control.advance(mediaPolicy.orphanGraceMs + 1);
    await scoped().cleanupOrphans();
    expect((await pool.query("SELECT 1 FROM media WHERE id=$1", [unreferenced.media.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM media WHERE id=$1", [referenced.media.id])).rowCount).toBe(1);
    expect(await mediaStore({ root: scope }).verify((await rowFor(referenced.media.id)).storage_key)).not.toBeNull();
  } finally { await rm(scope, { recursive: true, force: true }); }
});

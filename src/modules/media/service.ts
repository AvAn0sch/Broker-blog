import { createHmac, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../../contracts/errors";
import { systemClock, type Clock } from "../../infrastructure/clock";
import { withTransaction, type Transaction } from "../../infrastructure/db/transaction";
import { consumeRateLimits } from "../../infrastructure/rate-limit";
import { assertUploadSize, checksumOf, inspectImage, isStorageKey, mediaStore, storageKeyFor, type Faults, type MimeType } from "../../infrastructure/storage/media-store";
import { canonicalJson, requireWritableActor } from "../foundation/idempotency";
import { mediaPolicy } from "./policy";

export type MediaStatus = "staging" | "ready" | "failed";
export type MediaDto = { id: string; mime: MimeType; size: number; status: MediaStatus; createdAt: string };
export type MediaViewer = { id: string; role: "user" | "admin"; status: "normal" | "banned" } | null;
export type UploadResult = { media: MediaDto; replayed: boolean };
type MediaRow = { id: string; owner_id: string; storage_key: string; mime: MimeType; size: number; status: MediaStatus; created_at: Date };

const UPLOAD = "media.upload";
const notFound = () => new AppError("MEDIA_NOT_FOUND", 404, "图片不存在或无权访问。");

function mediaDto(row: MediaRow): MediaDto { return { id: row.id, mime: row.mime, size: row.size, status: row.status, createdAt: row.created_at.toISOString() }; }

export function mediaService(options: { pool: Pool; secret: string; root: string; clock?: Clock; faults?: Faults }) {
  const { pool, secret, root } = options;
  const clock = options.clock ?? systemClock;
  const store = mediaStore({ root, faults: options.faults });

  async function loadMedia(id: string): Promise<MediaDto> {
    const result = await pool.query<MediaRow>("SELECT id,owner_id,storage_key,mime,size,status,created_at FROM media WHERE id=$1", [id]);
    if (!result.rowCount) throw notFound();
    return mediaDto(result.rows[0]);
  }

  /** Failure is recorded, never reported as success; the file is removed best effort. */
  async function failUpload(id: string, code: string, key: string) {
    await pool.query("UPDATE media SET status='failed',failure_code=$2,upload_lease_until=null,checksum=null,updated_at=now() WHERE id=$1 AND status='staging'", [id, code]).catch(() => {});
    await store.remove(key).catch(() => {});
  }

  /**
   * Upload keeps file IO outside transactions and records the idempotency receipt only
   * after the file is complete, so a failed attempt never replays as success.
   */
  async function upload(input: { actorId: string; idempotencyKey: string; bytes: Buffer }): Promise<UploadResult> {
    assertUploadSize(input.bytes.length, mediaPolicy.maxBytes);
    const image = inspectImage(input.bytes);
    if (!image) throw new AppError("MEDIA_TYPE_REJECTED", 415, "只支持 JPEG、PNG 或 WebP 图片。");
    const checksum = checksumOf(input.bytes);
    const requestHash = createHmac("sha256", secret).update(canonicalJson({ size: input.bytes.length, mime: image.mime, checksum })).digest("hex");
    // A replay after a lost response must not consume upload quota, so dedup runs before limiting.
    const replayedId = await withTransaction(pool, async (tx) => {
      await requireWritableActor(tx, input.actorId);
      const replay = await tx.client.query<{ request_hash: string; result: { resourceId: string } | null }>(
        "SELECT request_hash,result FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3 FOR UPDATE", [input.actorId, UPLOAD, input.idempotencyKey]);
      if (replay.rowCount && replay.rows[0].request_hash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "同一提交标识不能用于不同内容。");
      return replay.rowCount ? replay.rows[0].result?.resourceId ?? null : null;
    });
    if (replayedId) return { media: await loadMedia(replayedId), replayed: true };
    await consumeRateLimits(pool, secret, clock, [
      { name: "media.upload.owner", subject: input.actorId, ...mediaPolicy.limits.upload },
      { name: "media.upload.global", subject: "all", ...mediaPolicy.limits.global },
    ]);
    const staged = await withTransaction(pool, async (tx) => {
      await requireWritableActor(tx, input.actorId);
      const mediaId = randomUUID();
      await tx.client.query(
        `INSERT INTO media (id,owner_id,storage_key,mime,size,status,upload_lease_until,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'staging',$6,now(),now())`,
        [mediaId, input.actorId, storageKeyFor(input.actorId, mediaId, image.extension), image.mime, input.bytes.length, new Date(clock.now().getTime() + mediaPolicy.uploadLeaseMs)]);
      return { mediaId };
    });

    const storageKey = storageKeyFor(input.actorId, staged.mediaId, image.extension);
    try {
      const place = await store.stage(storageKey, input.bytes);
      await store.commit(place.temporary, place.final);
    } catch {
      await failUpload(staged.mediaId, "storage_write_failed", storageKey);
      throw new AppError("MEDIA_UPLOAD_FAILED", 503, "图片保存失败，请重试。");
    }

    options.faults?.hit("media.finalize");
    const finished = await withTransaction(pool, async (tx) => {
      const ready = await tx.client.query("UPDATE media SET status='ready',checksum=$2,upload_lease_until=null,updated_at=now() WHERE id=$1 AND status='staging' RETURNING id", [staged.mediaId, checksum]);
      if (!ready.rowCount) throw new AppError("MEDIA_UPLOAD_FAILED", 503, "图片保存状态未确认，请稍后查询或重试。");
      const claimed = await tx.client.query<{ result: { resourceId: string } }>(
        "INSERT INTO idempotency_keys (actor_id,operation,key,request_hash,result) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (actor_id,operation,key) DO NOTHING RETURNING result",
        [input.actorId, UPLOAD, input.idempotencyKey, requestHash, JSON.stringify({ resourceId: staged.mediaId })]);
      if (claimed.rowCount) return { mediaId: staged.mediaId, discarded: null };
      const winner = await tx.client.query<{ request_hash: string; result: { resourceId: string } }>(
        "SELECT request_hash,result FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3", [input.actorId, UPLOAD, input.idempotencyKey]);
      if (winner.rows[0].request_hash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT", 409, "同一提交标识不能用于不同内容。");
      await tx.client.query("UPDATE media SET status='failed',failure_code='duplicate_upload',upload_lease_until=null,checksum=null,updated_at=now() WHERE id=$1", [staged.mediaId]);
      return { mediaId: winner.rows[0].result.resourceId, discarded: staged.mediaId };
    });
    if (finished.discarded) await store.remove(storageKey).catch(() => {});
    return { media: await loadMedia(finished.mediaId), replayed: Boolean(finished.discarded) };
  }

  /** Read permission follows current references only: owner, live publication, saved avatar, reviewable governance. */
  async function read(input: { mediaId: string; viewer: MediaViewer }): Promise<{ mime: MimeType; bytes: Buffer }> {
    const result = await pool.query<{ storage_key: string; mime: MimeType; owner_id: string; published: boolean; avatar: boolean; review: boolean; taken_down: boolean }>(
      `SELECT m.storage_key,m.mime,m.owner_id,
        EXISTS(SELECT 1 FROM publication_media pm JOIN articles a ON a.id=pm.article_id WHERE pm.media_id=m.id AND a.status='published') AS published,
        EXISTS(SELECT 1 FROM users u WHERE u.avatar_media_id=m.id) AS avatar,
        EXISTS(SELECT 1 FROM review_media rm WHERE rm.media_id=m.id) AS review,
        EXISTS(SELECT 1 FROM publication_media pm JOIN articles a ON a.id=pm.article_id WHERE pm.media_id=m.id AND a.status='taken_down') AS taken_down
       FROM media m WHERE m.id=$1 AND m.status='ready'`, [input.mediaId]);
    if (!result.rowCount) throw notFound();
    const row = result.rows[0];
    const reviewer = input.viewer?.role === "admin" && input.viewer.status === "normal";
    const allowed = input.viewer?.id === row.owner_id || row.published || row.avatar || (reviewer && (row.review || row.taken_down));
    if (!allowed) throw notFound();
    return { mime: row.mime, bytes: await store.read(row.storage_key) };
  }

  /** Publish, revision and review submission re-check ownership and readiness inside their transaction. */
  async function validateReferences(tx: Transaction, actorId: string, mediaIds: string[]) {
    const unique = [...new Set(mediaIds)];
    if (!unique.length) return;
    const rows = (await tx.client.query<{ id: string; owner_id: string; status: MediaStatus }>(
      "SELECT id,owner_id,status FROM media WHERE id = ANY($1::uuid[]) FOR NO KEY UPDATE", [unique])).rows;
    if (rows.length !== unique.length) throw new AppError("MEDIA_NOT_FOUND", 400, "图片不存在。");
    for (const row of rows) {
      if (row.owner_id !== actorId) throw new AppError("MEDIA_FORBIDDEN", 403, "不能引用他人的图片。");
      if (row.status !== "ready") throw new AppError("MEDIA_NOT_READY", 409, "图片尚未完成上传，不能发布或送审。");
    }
  }

  /** Interrupted uploads: finish a complete file, otherwise mark failed. Files are never assumed. */
  async function recoverStaged(limit = 20) {
    const candidates = (await pool.query<MediaRow>(
      "SELECT id,owner_id,storage_key,mime,size,status,created_at FROM media WHERE status='staging' AND upload_lease_until < $1 ORDER BY created_at LIMIT $2",
      [clock.now(), limit])).rows;
    let completed = 0; let failed = 0;
    for (const candidate of candidates) {
      const verified = await store.verify(candidate.storage_key);
      // Promote a leftover partial file before the row claims readiness: never ready without a final file.
      let promoted = true;
      if (verified?.partial) { try { await store.promote(candidate.storage_key); } catch { promoted = false; } }
      const outcome = await withTransaction(pool, async (tx) => {
        const locked = await tx.client.query<{ status: MediaStatus; upload_lease_until: Date }>("SELECT status,upload_lease_until FROM media WHERE id=$1 FOR UPDATE", [candidate.id]);
        if (!locked.rowCount || locked.rows[0].status !== "staging" || locked.rows[0].upload_lease_until > clock.now()) return "skipped";
        if (verified && promoted) {
          await tx.client.query("UPDATE media SET status='ready',checksum=$2,upload_lease_until=null,updated_at=now() WHERE id=$1", [candidate.id, verified.checksum]);
          return "completed";
        }
        await tx.client.query("UPDATE media SET status='failed',failure_code='incomplete_upload',upload_lease_until=null,checksum=null,updated_at=now() WHERE id=$1", [candidate.id]);
        return "failed";
      });
      if (outcome === "failed") await store.remove(candidate.storage_key).catch(() => {});
      if (outcome === "completed") completed++;
      if (outcome === "failed") failed++;
    }
    return { completed, failed, scanned: candidates.length };
  }

  /** Cleanup only touches files past the grace period with no record or no reference and no active lease. */
  async function cleanupOrphans(limit = 200) {
    const files = await store.list(limit);
    let removed = 0;
    for (const file of files) {
      if (file.mtimeMs > clock.now().getTime() - mediaPolicy.orphanGraceMs) continue;
      const key = file.key.replace(/\.partial$/, "");
      // Media objects only: the root also holds unrelated run artifacts (heartbeat, captcha answers).
      if (!isStorageKey(key)) continue;
      const row = (await pool.query<{ id: string; status: MediaStatus }>("SELECT id,status FROM media WHERE storage_key=$1", [key])).rows[0];
      if (row?.status === "staging") continue;
      if (row?.status === "ready") {
        const referenced = (await pool.query<{ referenced: boolean }>(
          `SELECT (EXISTS(SELECT 1 FROM draft_media WHERE media_id=$1) OR EXISTS(SELECT 1 FROM publication_media WHERE media_id=$1)
             OR EXISTS(SELECT 1 FROM review_media WHERE media_id=$1) OR EXISTS(SELECT 1 FROM users WHERE avatar_media_id=$1)) AS referenced`, [row.id])).rows[0].referenced;
        if (referenced) continue;
        const deleted = await withTransaction(pool, async (tx) => {
          await tx.client.query("SELECT id FROM media WHERE id=$1 FOR UPDATE", [row.id]);
          const stillReferenced = (await tx.client.query<{ referenced: boolean }>(
            `SELECT (EXISTS(SELECT 1 FROM draft_media WHERE media_id=$1) OR EXISTS(SELECT 1 FROM publication_media WHERE media_id=$1)
               OR EXISTS(SELECT 1 FROM review_media WHERE media_id=$1) OR EXISTS(SELECT 1 FROM users WHERE avatar_media_id=$1)) AS referenced`, [row.id])).rows[0].referenced;
          if (stillReferenced) return false;
          await tx.client.query("DELETE FROM media WHERE id=$1", [row.id]);
          return true;
        });
        if (!deleted) continue;
      } else if (row?.status === "failed") {
        await pool.query("DELETE FROM media WHERE id=$1 AND status='failed'", [row.id]);
      }
      await store.remove(key);
      removed++;
    }
    return { removed, scanned: files.length };
  }

  return { upload, read, validateReferences, recoverStaged, cleanupOrphans };
}

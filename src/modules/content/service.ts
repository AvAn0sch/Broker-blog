import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../../contracts/errors";
import { systemClock, type Clock } from "../../infrastructure/clock";
import { withTransaction, type Transaction } from "../../infrastructure/db/transaction";
import { requireWritableActor, withIdempotency } from "../foundation/idempotency";
import type { mediaService } from "../media/service";
import { extractMediaIds } from "./policy";

export type ArticleStatus = "draft" | "published" | "taken_down" | "deleted";
export type DraftDto = { articleId: string; status: ArticleStatus; version: number; title: string; markdown: string; summary: string; savedAt: string };
type DraftRow = { article_id: string; status: ArticleStatus; version: number; title: string; markdown: string; summary: string; saved_at: Date };
type Media = ReturnType<typeof mediaService>;

const draftDto = (row: DraftRow): DraftDto => ({ articleId: row.article_id, status: row.status, version: row.version, title: row.title, markdown: row.markdown, summary: row.summary, savedAt: row.saved_at.toISOString() });
const notFound = () => new AppError("ARTICLE_NOT_FOUND", 404, "草稿不存在。");
const CONTENT_COLUMNS = "d.article_id,a.status,d.version,d.title,d.markdown,d.summary,d.saved_at";

export function contentService(options: { pool: Pool; secret: string; media: Media; clock?: Clock }) {
  const { pool, secret, media } = options;
  const clock = options.clock ?? systemClock;

  async function replaceMediaReferences(tx: Transaction, actorId: string, articleId: string, mediaIds: string[]) {
    if (mediaIds.length) await media.validateReferences(tx, actorId, mediaIds);
    await tx.client.query("DELETE FROM draft_media WHERE article_id=$1", [articleId]);
    for (const mediaId of mediaIds) await tx.client.query("INSERT INTO draft_media (article_id,media_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [articleId, mediaId]);
  }

  /** New drafts are idempotent: a retried create returns the original article instead of a duplicate. */
  async function createDraft(input: { actorId: string; idempotencyKey: string; title?: string; markdown?: string; summary?: string }) {
    const request = { title: input.title ?? "", markdown: input.markdown ?? "", summary: input.summary ?? "" };
    const { receipt, replayed } = await withTransaction(pool, (tx) => withIdempotency(tx, {
      actorId: input.actorId, operation: "article.create", key: input.idempotencyKey, request, hashSecret: secret,
      authorize: (t) => requireWritableActor(t, input.actorId),
    }, async (t) => {
      const articleId = randomUUID();
      await t.client.query("INSERT INTO articles (id,author_id,status) VALUES ($1,$2,'draft')", [articleId, input.actorId]);
      await t.client.query("INSERT INTO article_drafts (article_id,version,title,markdown,summary) VALUES ($1,1,$2,$3,$4)", [articleId, request.title, request.markdown, request.summary]);
      await replaceMediaReferences(t, input.actorId, articleId, extractMediaIds(request.markdown));
      return { resourceId: articleId, version: 1 };
    }));
    // The receipt identifies this write; the current draft may already include another window's write.
    return { draft: await loadDraft({ viewerId: input.actorId, articleId: receipt.resourceId }), replayed, version: receipt.version! };
  }

  /**
   * Saving locks the article and updates the draft only when the caller's base version still matches,
   * so an older window can never overwrite newer text.
   */
  async function saveDraft(input: { actorId: string; articleId: string; idempotencyKey: string; baseDraftVersion: number; title: string; markdown: string; summary: string }) {
    const mediaIds = extractMediaIds(input.markdown);
    const { receipt, replayed } = await withTransaction(pool, (tx) => withIdempotency(tx, {
      actorId: input.actorId, operation: "article.save_draft", key: input.idempotencyKey, hashSecret: secret,
      request: { articleId: input.articleId, baseDraftVersion: input.baseDraftVersion, title: input.title, markdown: input.markdown, summary: input.summary, mediaIds },
      authorize: (t) => requireWritableActor(t, input.actorId),
    }, async (t) => {
      const article = await t.client.query<{ status: ArticleStatus; author_id: string }>("SELECT status,author_id FROM articles WHERE id=$1 FOR NO KEY UPDATE", [input.articleId]);
      if (!article.rowCount || article.rows[0].author_id !== input.actorId) throw notFound();
      if (article.rows[0].status === "deleted") throw new AppError("ARTICLE_DELETED", 409, "文章已删除，不能继续保存草稿。");
      const updated = await t.client.query<{ version: number }>(
        "UPDATE article_drafts SET version=version+1,title=$2,markdown=$3,summary=$4,saved_at=now() WHERE article_id=$1 AND version=$5 RETURNING version",
        [input.articleId, input.title, input.markdown, input.summary, input.baseDraftVersion]);
      if (!updated.rowCount) throw new AppError("DRAFT_VERSION_CONFLICT", 409, "草稿已在其他窗口更新，请保留本地修改或载入服务器版本。");
      await replaceMediaReferences(t, input.actorId, input.articleId, mediaIds);
      return { resourceId: input.articleId, version: updated.rows[0].version };
    }));
    return { draft: await loadDraft({ viewerId: input.actorId, articleId: receipt.resourceId }), replayed, version: receipt.version! };
  }

  /** Drafts are readable and writable by their author only; a banned author keeps read-only access. */
  async function loadDraft(input: { viewerId: string; articleId: string }) {
    const result = await pool.query<DraftRow>(
      `SELECT ${CONTENT_COLUMNS} FROM articles a JOIN article_drafts d ON d.article_id=a.id WHERE a.id=$1 AND a.author_id=$2`, [input.articleId, input.viewerId]);
    if (!result.rowCount) throw notFound();
    return draftDto(result.rows[0]);
  }

  /** Ops helper: drafts left mid-edit by a crashed window are listed for recovery or cleanup. */
  async function listStaleDrafts(input: { olderThanMs: number; limit?: number }) {
    const result = await pool.query<DraftRow>(
      `SELECT ${CONTENT_COLUMNS} FROM articles a JOIN article_drafts d ON d.article_id=a.id
       WHERE a.status='draft' AND d.saved_at < $1 ORDER BY d.saved_at LIMIT $2`,
      [new Date(clock.now().getTime() - input.olderThanMs), input.limit ?? 50]);
    return result.rows.map(draftDto);
  }

  return { createDraft, saveDraft, loadDraft, listStaleDrafts };
}

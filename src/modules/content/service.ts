import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../../contracts/errors";
import { systemClock, type Clock } from "../../infrastructure/clock";
import { withTransaction, type Transaction } from "../../infrastructure/db/transaction";
import { requireWritableActor, withIdempotency } from "../foundation/idempotency";
import type { mediaService } from "../media/service";
import { draftCreateSchema, draftSaveSchema, extractMediaIds, publishSchema, deleteArticleSchema } from "./policy";
import { publicationMarkdown, suggestedSummary } from "./markdown";
import { z } from "zod";

export type ArticleStatus = "draft" | "published" | "taken_down" | "deleted";
export type DraftDto = { articleId: string; status: ArticleStatus; stateVersion: number; version: number; title: string; markdown: string; summary: string; tagIds: string[]; savedAt: string };
type DraftRow = { article_id: string; status: ArticleStatus; state_version: number; version: number; title: string; markdown: string; summary: string; tag_ids: string[]; saved_at: Date };
type Media = ReturnType<typeof mediaService>;

const draftDto = (row: DraftRow): DraftDto => ({ articleId: row.article_id, status: row.status, stateVersion: row.state_version, version: row.version, title: row.title, markdown: row.markdown, summary: row.summary, tagIds: row.tag_ids, savedAt: row.saved_at.toISOString() });
const notFound = () => new AppError("ARTICLE_NOT_FOUND", 404, "草稿不存在。");
const CONTENT_COLUMNS = "d.article_id,a.status,a.state_version,d.version,d.title,d.markdown,d.summary,d.saved_at,ARRAY(SELECT tag_id FROM draft_tags WHERE article_id=a.id ORDER BY tag_id) AS tag_ids";

export function contentService(options: { pool: Pool; secret: string; media: Media; clock?: Clock; faults?: { hit(point: string): void }; hooks?: { afterArticleLock?(): Promise<void> } }) {
  const { pool, secret, media } = options;
  const clock = options.clock ?? systemClock;

  async function lockArticle(tx: Transaction, actorId: string, articleId: string) {
    const row = (await tx.client.query<{ status: ArticleStatus; state_version: number; author_id: string }>("SELECT status,state_version,author_id FROM articles WHERE id=$1 FOR NO KEY UPDATE", [articleId])).rows[0];
    if (!row || row.author_id !== actorId) throw notFound();
    return row;
  }

  async function replaceDraftTags(tx: Transaction, articleId: string, tagIds?: string[]) {
    if (!tagIds) return;
    const found = await tx.client.query("SELECT id FROM tags WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE", [tagIds]);
    if (found.rowCount !== tagIds.length) throw new AppError("TAG_NOT_FOUND", 400, "选择的标签不存在。");
    await tx.client.query("DELETE FROM draft_tags WHERE article_id=$1", [articleId]);
    for (const tagId of tagIds) await tx.client.query("INSERT INTO draft_tags VALUES ($1,$2)", [articleId, tagId]);
  }

  async function replaceMediaReferences(tx: Transaction, actorId: string, articleId: string, mediaIds: string[]) {
    if (mediaIds.length) await media.validateReferences(tx, actorId, mediaIds);
    await tx.client.query("DELETE FROM draft_media WHERE article_id=$1", [articleId]);
    for (const mediaId of mediaIds) await tx.client.query("INSERT INTO draft_media (article_id,media_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [articleId, mediaId]);
  }

  /** New drafts are idempotent: a retried create returns the original article instead of a duplicate. */
  async function createDraft(input: { actorId: string; idempotencyKey: string; title?: string; markdown?: string; summary?: string; tagIds?: string[] }) {
    draftCreateSchema.parse({ title: input.title, markdown: input.markdown, summary: input.summary, tagIds: input.tagIds });
    const request = { title: input.title ?? "", markdown: input.markdown ?? "", summary: input.summary ?? "", tagIds: [...(input.tagIds ?? [])].sort() };
    const { receipt, replayed } = await withTransaction(pool, (tx) => withIdempotency(tx, {
      actorId: input.actorId, operation: "article.create", key: input.idempotencyKey, request, hashSecret: secret,
      authorize: (t) => requireWritableActor(t, input.actorId),
    }, async (t) => {
      const articleId = randomUUID();
      await t.client.query("INSERT INTO articles (id,author_id,status) VALUES ($1,$2,'draft')", [articleId, input.actorId]);
      await t.client.query("INSERT INTO article_drafts (article_id,version,title,markdown,summary) VALUES ($1,1,$2,$3,$4)", [articleId, request.title, request.markdown, request.summary]);
      await replaceDraftTags(t, articleId, request.tagIds);
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
  async function saveDraft(input: { actorId: string; articleId: string; idempotencyKey: string; baseDraftVersion: number; title: string; markdown: string; summary: string; tagIds?: string[] }) {
    draftSaveSchema.parse({ baseDraftVersion: input.baseDraftVersion, title: input.title, markdown: input.markdown, summary: input.summary, tagIds: input.tagIds });
    const mediaIds = extractMediaIds(input.markdown);
    const { receipt, replayed } = await withTransaction(pool, (tx) => withIdempotency(tx, {
      actorId: input.actorId, operation: "article.save_draft", key: input.idempotencyKey, hashSecret: secret,
      request: { articleId: input.articleId, baseDraftVersion: input.baseDraftVersion, title: input.title, markdown: input.markdown, summary: input.summary, mediaIds, tagIds: input.tagIds ? [...input.tagIds].sort() : null },
      authorize: (t) => requireWritableActor(t, input.actorId),
    }, async (t) => {
      const article = await t.client.query<{ status: ArticleStatus; author_id: string }>("SELECT status,author_id FROM articles WHERE id=$1 FOR NO KEY UPDATE", [input.articleId]);
      if (!article.rowCount || article.rows[0].author_id !== input.actorId) throw notFound();
      if (article.rows[0].status === "deleted") throw new AppError("ARTICLE_DELETED", 409, "文章已删除，不能继续保存草稿。");
      const updated = await t.client.query<{ version: number }>(
        "UPDATE article_drafts SET version=version+1,title=$2,markdown=$3,summary=$4,saved_at=now() WHERE article_id=$1 AND version=$5 RETURNING version",
        [input.articleId, input.title, input.markdown, input.summary, input.baseDraftVersion]);
      if (!updated.rowCount) throw new AppError("DRAFT_VERSION_CONFLICT", 409, "草稿已在其他窗口更新，请保留本地修改或载入服务器版本。");
      await replaceDraftTags(t, input.articleId, input.tagIds);
      await replaceMediaReferences(t, input.actorId, input.articleId, mediaIds);
      return { resourceId: input.articleId, version: updated.rows[0].version };
    }));
    return { draft: await loadDraft({ viewerId: input.actorId, articleId: receipt.resourceId }), replayed, version: receipt.version! };
  }

  /** Drafts are readable and writable by their author only; a banned author keeps read-only access. */
  async function loadDraft(input: { viewerId: string; articleId: string }) {
    if (!z.uuid().safeParse(input.articleId).success) throw notFound();
    const result = await pool.query<DraftRow>(
       `SELECT ${CONTENT_COLUMNS} FROM articles a JOIN article_drafts d ON d.article_id=a.id WHERE a.id=$1 AND a.author_id=$2 AND a.status<>'deleted'`, [input.articleId, input.viewerId]);
    if (!result.rowCount) throw notFound();
    return draftDto(result.rows[0]);
  }

  async function listTags() {
    return (await pool.query<{ id: string; slug: string; name: string; enabled: boolean }>("SELECT id,slug,name,enabled FROM tags ORDER BY slug,id")).rows;
  }

  async function publish(input: { actorId: string; articleId: string; idempotencyKey: string; stateVersion: number; draftVersion: number }) {
    publishSchema.parse({ stateVersion: input.stateVersion, draftVersion: input.draftVersion });
    const { receipt, replayed } = await withTransaction(pool, (tx) => withIdempotency(tx, {
      actorId: input.actorId, operation: "article.publish", key: input.idempotencyKey, hashSecret: secret,
      request: { articleId: input.articleId, stateVersion: input.stateVersion, draftVersion: input.draftVersion },
      authorize: async (t) => { await requireWritableActor(t, input.actorId); await lockArticle(t, input.actorId, input.articleId); },
    }, async (t) => {
      const article = await lockArticle(t, input.actorId, input.articleId);
      await options.hooks?.afterArticleLock?.();
      if (article.state_version !== input.stateVersion) throw new AppError("ARTICLE_STATE_CONFLICT", 409, "文章状态已变化，请刷新后重新确认。");
      if (!["draft", "published"].includes(article.status)) throw new AppError("ARTICLE_STATE_CONFLICT", 409, "已下架文章须通过复核恢复；已删除文章不能发布。");
      const draft = (await t.client.query<{ version: number; title: string; markdown: string; summary: string }>("SELECT version,title,markdown,summary FROM article_drafts WHERE article_id=$1 FOR UPDATE", [input.articleId])).rows[0];
      if (draft.version !== input.draftVersion) throw new AppError("DRAFT_VERSION_CONFLICT", 409, "草稿已变化，请保存并重新确认要发布的版本。");
      if (!draft.title.trim() || !draft.markdown.trim()) throw new AppError("PUBLICATION_INVALID", 400, "发布时标题和正文不能为空。", { title: !draft.title.trim() ? ["请填写标题。"] : [], markdown: !draft.markdown.trim() ? ["请填写正文。"] : [] });
      const parsed = publicationMarkdown(draft.markdown);
      if (parsed.invalidImage) throw new AppError("PUBLICATION_IMAGE_INVALID", 400, "图片必须使用上传完成的站内图片，请重新上传外部、临时或无效图片。");
      const selected = (await t.client.query<{ id: string; enabled: boolean }>("SELECT t.id,t.enabled FROM tags t JOIN draft_tags dt ON dt.tag_id=t.id WHERE dt.article_id=$1 ORDER BY t.id FOR SHARE OF t", [input.articleId])).rows;
      if (selected.length < 1 || selected.length > 3 || selected.some((tag) => !tag.enabled)) throw new AppError("PUBLICATION_TAGS_INVALID", 400, "请选择 1–3 个有效标签。", { tagIds: ["标签已停用或未选择，请重新选择。"] });
      await media.validateReferences(t, input.actorId, parsed.mediaIds);
      const summary = draft.summary.trim() || suggestedSummary(draft.markdown);
      const now = clock.now();
      await t.client.query(`INSERT INTO article_publications (article_id,source_draft_version,title,markdown,summary,plain_text,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (article_id) DO UPDATE SET source_draft_version=EXCLUDED.source_draft_version,title=EXCLUDED.title,markdown=EXCLUDED.markdown,summary=EXCLUDED.summary,plain_text=EXCLUDED.plain_text,published_at=EXCLUDED.published_at`,
      [input.articleId, draft.version, draft.title, draft.markdown, summary, parsed.plainText, now]);
      await t.client.query("DELETE FROM publication_tags WHERE article_id=$1", [input.articleId]);
      for (const tag of selected) await t.client.query("INSERT INTO publication_tags VALUES ($1,$2)", [input.articleId, tag.id]);
      await t.client.query("DELETE FROM publication_media WHERE article_id=$1", [input.articleId]);
      for (const mediaId of parsed.mediaIds) await t.client.query("INSERT INTO publication_media VALUES ($1,$2)", [input.articleId, mediaId]);
      options.faults?.hit("content.after-references");
      await t.client.query("UPDATE articles SET status='published',state_version=state_version+1,first_published_at=coalesce(first_published_at,$2),updated_at=$2 WHERE id=$1", [input.articleId, now]);
      await t.client.query("INSERT INTO domain_events (type,payload) VALUES ('article.published',$1::jsonb)", [JSON.stringify({ articleId: input.articleId, actorId: input.actorId })]);
      options.faults?.hit("content.after-event");
      return { resourceId: input.articleId, version: article.state_version + 1 };
    }));
    // Minimal write receipt stays stable even after a later update or deletion.
    return { articleId: receipt.resourceId, stateVersion: receipt.version!, replayed };
  }

  async function deleteArticle(input: { actorId: string; articleId: string; idempotencyKey: string; stateVersion: number }) {
    deleteArticleSchema.parse({ stateVersion: input.stateVersion });
    const { receipt, replayed } = await withTransaction(pool, (tx) => withIdempotency(tx, {
      actorId: input.actorId, operation: "article.delete", key: input.idempotencyKey, hashSecret: secret,
      request: { articleId: input.articleId, stateVersion: input.stateVersion },
      authorize: async (t) => { await requireWritableActor(t, input.actorId); await lockArticle(t, input.actorId, input.articleId); },
    }, async (t) => {
      const article = await lockArticle(t, input.actorId, input.articleId);
      await options.hooks?.afterArticleLock?.();
      if (article.status === "deleted" || article.state_version !== input.stateVersion) throw new AppError("ARTICLE_STATE_CONFLICT", 409, "文章状态已变化，请刷新后重新确认删除。");
      await t.client.query("UPDATE review_requests SET status='terminated',version=version+1,decided_at=$2 WHERE article_id=$1 AND status='pending'", [input.articleId, clock.now()]);
      await t.client.query("UPDATE articles SET status='deleted',state_version=state_version+1,updated_at=$2 WHERE id=$1", [input.articleId, clock.now()]);
      await t.client.query("INSERT INTO domain_events (type,payload) VALUES ('article.deleted',$1::jsonb)", [JSON.stringify({ articleId: input.articleId, actorId: input.actorId })]);
      options.faults?.hit("content.after-event");
      return { resourceId: input.articleId, version: article.state_version + 1 };
    }));
    return { articleId: receipt.resourceId, stateVersion: receipt.version!, replayed };
  }

  /** Only the live publication projection is public, including for its own author. */
  async function loadPublic(articleId: string) {
    if (!z.uuid().safeParse(articleId).success) throw notFound();
    const row = (await pool.query<{
      id: string; title: string; markdown: string; summary: string; first_published_at: Date; updated_at: Date;
      author_id: string; nickname: string; tags: { id: string; slug: string; name: string }[];
    }>(`SELECT a.id,p.title,p.markdown,p.summary,a.first_published_at,a.updated_at,u.id AS author_id,u.nickname,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'slug',t.slug,'name',t.name) ORDER BY t.slug) FROM publication_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.article_id=a.id),'[]'::jsonb) AS tags
      FROM articles a JOIN article_publications p ON p.article_id=a.id JOIN users u ON u.id=a.author_id WHERE a.id=$1 AND a.status='published'`, [articleId])).rows[0];
    if (!row) throw notFound();
    return { id: row.id, title: row.title, markdown: row.markdown, summary: row.summary, author: { id: row.author_id, nickname: row.nickname }, tags: row.tags, firstPublishedAt: row.first_published_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  }

  async function listMine(input: { viewerId: string; status?: string; cursor?: string; limit?: number }) {
    const status = z.enum(["all", "draft", "published", "taken_down"]).parse(input.status ?? "all");
    const limit = z.number().int().min(1).max(50).parse(input.limit ?? 20);
    let cursor: { createdAt: string; id: string } | null = null;
    if (input.cursor) {
      try { cursor = z.strictObject({ createdAt: z.iso.datetime(), id: z.uuid() }).parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString())); }
      catch { throw new AppError("CURSOR_INVALID", 400, "分页位置无效，请从第一页重试。"); }
    }
    const rows = (await pool.query<{
      id: string; status: ArticleStatus; state_version: number; title: string; version: number; source_draft_version: number | null;
      created_at: Date; cursor_time: string; takedown_reason: string | null; review_status: string | null;
    }>(`SELECT a.id,a.status,a.state_version,d.title,d.version,p.source_draft_version,a.created_at,a.takedown_reason,
      to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
      (SELECT r.status FROM review_requests r WHERE r.article_id=a.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS review_status
      FROM articles a JOIN article_drafts d ON d.article_id=a.id LEFT JOIN article_publications p ON p.article_id=a.id
      WHERE a.author_id=$1 AND a.status<>'deleted' AND ($2='all' OR a.status=$2)
      AND ($3::timestamptz IS NULL OR (a.created_at,a.id)<($3::timestamptz,$4::uuid))
      ORDER BY a.created_at DESC,a.id DESC LIMIT $5`, [input.viewerId, status, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1])).rows;
    const more = rows.length > limit, page = rows.slice(0, limit), last = page.at(-1);
    return { items: page.map((row) => ({ id: row.id, title: row.title, status: row.status, stateVersion: row.state_version, draftVersion: row.version, hasUnpublishedChanges: row.source_draft_version !== null && row.source_draft_version !== row.version, takedownReason: row.takedown_reason, reviewStatus: row.review_status })),
      nextCursor: more && last ? Buffer.from(JSON.stringify({ createdAt: last.cursor_time, id: last.id })).toString("base64url") : null };
  }

  async function sitemapEntries() {
    return (await pool.query<{ id: string; updated_at: Date }>("SELECT a.id,a.updated_at FROM articles a JOIN article_publications p ON p.article_id=a.id WHERE a.status='published' ORDER BY a.id")).rows.map((row) => ({ id: row.id, updatedAt: row.updated_at.toISOString() }));
  }

  /** Ops helper: drafts left mid-edit by a crashed window are listed for recovery or cleanup. */
  async function listStaleDrafts(input: { olderThanMs: number; limit?: number }) {
    const result = await pool.query<DraftRow>(
      `SELECT ${CONTENT_COLUMNS} FROM articles a JOIN article_drafts d ON d.article_id=a.id
       WHERE a.status='draft' AND d.saved_at < $1 ORDER BY d.saved_at LIMIT $2`,
      [new Date(clock.now().getTime() - input.olderThanMs), input.limit ?? 50]);
    return result.rows.map(draftDto);
  }

  return { createDraft, saveDraft, loadDraft, listStaleDrafts, listTags, publish, deleteArticle, loadPublic, listMine, sitemapEntries };
}

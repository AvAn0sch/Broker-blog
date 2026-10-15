import type { Pool } from "pg";
import { z } from "zod";
import { AppError } from "../../contracts/errors";
import { decodeFeedCursor, decodeTagCursor, encodeFeedCursor, encodeTagCursor } from "./cursor";
import { discoveryPolicy, feedScope, type FeedMode } from "./policy";

export type ArticleCard = {
  id: string; title: string; summary: string; firstPublishedAt: string; updatedAt: string; featured: boolean;
  author: { id: string; nickname: string; avatarMediaId: string | null };
  tags: { id: string; slug: string; name: string }[];
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type TagSummary = { id: string; slug: string; name: string; enabled: boolean; publishedCount: number };
export type AuthorProfile = { id: string; nickname: string; bio: string; avatarMediaId: string | null; joinedAt: string; publishedCount: number };

type CardRow = {
  id: string; title: string; summary: string; first_published_at: Date; updated_at: Date;
  author_id: string; nickname: string; avatar_media_id: string | null; featured: boolean; cursor_position: number | null;
  cursor_time: string; tags: { id: string; slug: string; name: string }[];
};
type TagRow = { id: string; slug: string; name: string; enabled: boolean; published_count: number };
type AuthorRow = { id: string; nickname: string; bio: string; avatar_media_id: string | null; created_at: Date; published_count: number };

/** 公开卡片投影：只取公开版本，绝不拼接工作草稿或私有字段。 */
const CARD_COLUMNS = `a.id,p.title,p.summary,a.first_published_at,a.updated_at,u.id AS author_id,u.nickname,u.avatar_media_id,
  (f.article_id IS NOT NULL) AS featured,f.position AS cursor_position,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'slug',t.slug,'name',t.name) ORDER BY t.slug) FROM publication_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.article_id=a.id),'[]'::jsonb) AS tags,
  to_char(a.first_published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time`;
const TAG_COLUMNS = `t.id,t.slug,t.name,t.enabled,(SELECT count(*)::int FROM publication_tags pt JOIN articles a ON a.id=pt.article_id AND a.status='published' WHERE pt.tag_id=t.id) AS published_count`;

const card = (row: CardRow): ArticleCard => ({
  id: row.id, title: row.title, summary: row.summary, featured: row.featured,
  firstPublishedAt: row.first_published_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  author: { id: row.author_id, nickname: row.nickname, avatarMediaId: row.avatar_media_id }, tags: row.tags,
});
const tag = (row: TagRow): TagSummary => ({ id: row.id, slug: row.slug, name: row.name, enabled: row.enabled, publishedCount: row.published_count });

function clampLimit(value: number | undefined, bounds: { defaultLimit: number; maxLimit: number }) {
  const requested = Number.isFinite(value) ? Math.trunc(value as number) : bounds.defaultLimit;
  return Math.min(Math.max(requested, 1), bounds.maxLimit);
}

export function discoveryService(options: { pool: Pool }) {
  const { pool } = options;

  /**
   * 首页、标签页与作者主页共用同一读取：只返回已发布内容。
   * 最新按 (first_published_at, id) 倒序；精选按 (position, article_id) 正序。
   */
  async function listFeed(input: { mode: FeedMode; tagSlug?: string | null; authorId?: string | null; cursor?: string | null; limit?: number }): Promise<Page<ArticleCard>> {
    const limit = clampLimit(input.limit, discoveryPolicy.feed);
    const scope = feedScope(input);
    const cursor = decodeFeedCursor(input.cursor ?? null, { mode: input.mode, scope });
    const rows = input.mode === "featured"
      ? (await pool.query<CardRow>(
        `SELECT ${CARD_COLUMNS} FROM featured_articles f
         JOIN articles a ON a.id=f.article_id AND a.status='published'
         JOIN article_publications p ON p.article_id=a.id
         JOIN users u ON u.id=a.author_id
         WHERE ($1::int IS NULL OR (f.position,f.article_id) > ($1::int,$2::uuid))
         ORDER BY f.position,f.article_id LIMIT $3`,
        [cursor ? Number(cursor.key) : null, cursor?.id ?? null, limit + 1])).rows
      : (await pool.query<CardRow>(
        `SELECT ${CARD_COLUMNS} FROM articles a
         JOIN article_publications p ON p.article_id=a.id
         JOIN users u ON u.id=a.author_id
         LEFT JOIN featured_articles f ON f.article_id=a.id
         WHERE a.status='published'
           AND ($1::text IS NULL OR EXISTS (SELECT 1 FROM publication_tags pt2 JOIN tags t2 ON t2.id=pt2.tag_id WHERE pt2.article_id=a.id AND t2.slug=$1))
           AND ($2::uuid IS NULL OR a.author_id=$2::uuid)
           AND ($3::timestamptz IS NULL OR (a.first_published_at,a.id) < ($3::timestamptz,$4::uuid))
         ORDER BY a.first_published_at DESC,a.id DESC LIMIT $5`,
        [input.tagSlug ?? null, input.authorId ?? null, cursor?.key ?? null, cursor?.id ?? null, limit + 1])).rows;
    const more = rows.length > limit, page = rows.slice(0, limit), last = page.at(-1);
    return {
      items: page.map(card),
      nextCursor: more && last
        ? encodeFeedCursor({ v: 1, mode: input.mode, scope, key: input.mode === "featured" ? String(last.cursor_position ?? 0) : last.cursor_time, id: last.id })
        : null,
    };
  }

  /** 标签总览：包含停用标签，并给出公开文章数（真实计数）。 */
  async function listTags(input: { cursor?: string | null; limit?: number } = {}): Promise<Page<TagSummary>> {
    const limit = clampLimit(input.limit, discoveryPolicy.tags);
    const cursor = decodeTagCursor(input.cursor ?? null);
    const rows = (await pool.query<TagRow>(
      `SELECT ${TAG_COLUMNS} FROM tags t
       WHERE ($1::text IS NULL OR (t.name,t.id) > ($1::text,$2::uuid))
       ORDER BY t.name,t.id LIMIT $3`,
      [cursor?.name ?? null, cursor?.id ?? null, limit + 1])).rows;
    const more = rows.length > limit, page = rows.slice(0, limit), last = page.at(-1);
    return { items: page.map(tag), nextCursor: more && last ? encodeTagCursor({ v: 1, kind: "tags", name: last.name, id: last.id }) : null };
  }

  /** 标签详情：停用标签仍可读取其既有公开文章，只是不能用于新发布。 */
  async function loadTag(input: { slug: string }): Promise<TagSummary> {
    const slug = z.string().min(1).max(64).safeParse(input.slug);
    if (!slug.success) throw new AppError("TAG_NOT_FOUND", 404, "标签不存在。");
    const row = (await pool.query<TagRow>(`SELECT ${TAG_COLUMNS} FROM tags t WHERE t.slug=$1`, [slug.data])).rows[0];
    if (!row) throw new AppError("TAG_NOT_FOUND", 404, "标签不存在。");
    return tag(row);
  }

  /** 公开作者资料：不含邮箱、状态等私有字段。 */
  async function loadAuthor(input: { id: string }): Promise<AuthorProfile> {
    if (!z.uuid().safeParse(input.id).success) throw new AppError("USER_NOT_FOUND", 404, "用户不存在。");
    const row = (await pool.query<AuthorRow>(
      `SELECT u.id,u.nickname,u.bio,u.avatar_media_id,u.created_at,
        (SELECT count(*)::int FROM articles a WHERE a.author_id=u.id AND a.status='published') AS published_count
       FROM users u WHERE u.id=$1`, [input.id])).rows[0];
    if (!row) throw new AppError("USER_NOT_FOUND", 404, "用户不存在。");
    return { id: row.id, nickname: row.nickname, bio: row.bio, avatarMediaId: row.avatar_media_id, joinedAt: row.created_at.toISOString(), publishedCount: row.published_count };
  }

  return { listFeed, listTags, loadTag, loadAuthor };
}

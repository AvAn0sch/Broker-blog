import { sql } from "drizzle-orm";
import { pgTable, uuid, text, varchar, integer, boolean, timestamp, jsonb, primaryKey, uniqueIndex, index, check, type AnyPgColumn } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const content = () => ({ title: varchar("title", { length: 100 }).notNull().default(""), markdown: text("markdown").notNull().default(""), summary: varchar("summary", { length: 200 }).notNull().default("") });

export const users = pgTable("users", {
  id: id(), emailNormalized: varchar("email_normalized", { length: 254 }).notNull(), passwordHash: text("password_hash").notNull(),
  nickname: varchar("nickname", { length: 30 }).notNull(), bio: varchar("bio", { length: 200 }).notNull().default(""),
  avatarMediaId: uuid("avatar_media_id").references((): AnyPgColumn => media.id),
  role: text("role").notNull().default("user"), status: text("status").notNull().default("normal"), createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_unique").on(t.emailNormalized), check("users_role_check", sql`${t.role} in ('user','admin')`), check("users_status_check", sql`${t.status} in ('normal','banned')`), check("users_nickname_check", sql`char_length(${t.nickname}) between 2 and 30`), check("users_email_normalized_check", sql`${t.emailNormalized} = lower(btrim(${t.emailNormalized}))`)]);

export const sessions = pgTable("sessions", {
  id: id(), userId: uuid("user_id").notNull().references(() => users.id), tokenHash: varchar("token_hash", { length: 64 }).notNull(), csrfHash: varchar("csrf_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: createdAt(),
}, (t) => [uniqueIndex("sessions_token_unique").on(t.tokenHash), index("sessions_user_expiry_idx").on(t.userId, t.expiresAt)]);

export const captchaChallenges = pgTable("captcha_challenges", {
  id: id(), browserBindingHash: varchar("browser_binding_hash", { length: 64 }).notNull(), purpose: text("purpose").notNull(), answerHmac: varchar("answer_hmac", { length: 64 }).notNull(),
  attempts: integer("attempts").notNull().default(0), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }), invalidatedAt: timestamp("invalidated_at", { withTimezone: true }), createdAt: createdAt(),
}, (t) => [check("captcha_purpose_check", sql`${t.purpose} in ('register','login')`), check("captcha_attempts_check", sql`${t.attempts} between 0 and 5`), index("captcha_expiry_idx").on(t.expiresAt)]);

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  action: varchar("action", { length: 64 }).notNull(), subjectHash: varchar("subject_hash", { length: 64 }).notNull(), windowStart: timestamp("window_start", { withTimezone: true }).notNull(), count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.action, t.subjectHash, t.windowStart] }), check("rate_count_check", sql`${t.count} >= 0`)]);

export const articles = pgTable("articles", {
  id: id(), authorId: uuid("author_id").notNull().references(() => users.id), status: text("status").notNull().default("draft"), stateVersion: integer("state_version").notNull().default(1),
  firstPublishedAt: timestamp("first_published_at", { withTimezone: true }), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), takedownReason: text("takedown_reason"), createdAt: createdAt(),
}, (t) => [check("articles_status_check", sql`${t.status} in ('draft','published','taken_down','deleted')`), check("articles_version_check", sql`${t.stateVersion} >= 1`), check("articles_published_time_check", sql`${t.status} <> 'published' or ${t.firstPublishedAt} is not null`), index("articles_public_order_idx").on(t.firstPublishedAt, t.id).where(sql`${t.status} = 'published'`), index("articles_author_idx").on(t.authorId, t.status)]);

export const articleDrafts = pgTable("article_drafts", {
  articleId: uuid("article_id").primaryKey().references(() => articles.id), version: integer("version").notNull().default(1), ...content(), savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("draft_version_check", sql`${t.version} >= 1`), check("draft_body_length_check", sql`char_length(${t.markdown}) <= 100000`)]);

export const articlePublications = pgTable("article_publications", {
  articleId: uuid("article_id").primaryKey().references(() => articles.id), sourceDraftVersion: integer("source_draft_version").notNull(), ...content(), plainText: text("plain_text").notNull(), publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("publication_fields_check", sql`${t.sourceDraftVersion} >= 1 and length(btrim(${t.title})) > 0 and length(btrim(${t.markdown})) > 0 and char_length(${t.markdown}) <= 100000`)]);

export const tags = pgTable("tags", { id: id(), slug: varchar("slug", { length: 64 }).notNull(), name: varchar("name", { length: 40 }).notNull(), enabled: boolean("enabled").notNull().default(true) }, (t) => [uniqueIndex("tags_slug_unique").on(t.slug)]);

export const media = pgTable("media", {
  id: id(), ownerId: uuid("owner_id").notNull().references((): AnyPgColumn => users.id), storageKey: text("storage_key").notNull(), mime: text("mime").notNull(), size: integer("size").notNull(), status: text("status").notNull().default("staging"), createdAt: createdAt(),
}, (t) => [uniqueIndex("media_storage_key_unique").on(t.storageKey), check("media_state_check", sql`${t.status} in ('staging','ready','failed')`), check("media_size_check", sql`${t.size} > 0 and ${t.size} <= 5242880`), check("media_mime_check", sql`${t.mime} in ('image/jpeg','image/png','image/webp')`)]);

export const reviewRequests = pgTable("review_requests", {
  id: id(), articleId: uuid("article_id").notNull().references(() => articles.id), sourceDraftVersion: integer("source_draft_version").notNull(), ...content(),
  status: text("status").notNull().default("pending"), version: integer("version").notNull().default(1), submittedBy: uuid("submitted_by").notNull().references(() => users.id),
  decisionBy: uuid("decision_by").references(() => users.id), reason: text("reason"), decidedAt: timestamp("decided_at", { withTimezone: true }), createdAt: createdAt(),
}, (t) => [uniqueIndex("reviews_one_pending").on(t.articleId).where(sql`${t.status} = 'pending'`), check("review_status_check", sql`${t.status} in ('pending','approved','rejected','withdrawn','terminated')`), check("review_fields_check", sql`${t.version} >= 1 and ${t.sourceDraftVersion} >= 1 and length(btrim(${t.title})) > 0 and length(btrim(${t.markdown})) > 0 and char_length(${t.markdown}) <= 100000`)]);

export const draftTags = pgTable("draft_tags", { articleId: uuid("article_id").notNull().references(() => articleDrafts.articleId), tagId: uuid("tag_id").notNull().references(() => tags.id) }, (t) => [primaryKey({ columns: [t.articleId, t.tagId] })]);
export const publicationTags = pgTable("publication_tags", { articleId: uuid("article_id").notNull().references(() => articlePublications.articleId), tagId: uuid("tag_id").notNull().references(() => tags.id) }, (t) => [primaryKey({ columns: [t.articleId, t.tagId] })]);
export const reviewTags = pgTable("review_tags", { reviewId: uuid("review_id").notNull().references(() => reviewRequests.id), tagId: uuid("tag_id").notNull().references(() => tags.id) }, (t) => [primaryKey({ columns: [t.reviewId, t.tagId] })]);
export const draftMedia = pgTable("draft_media", { articleId: uuid("article_id").notNull().references(() => articleDrafts.articleId), mediaId: uuid("media_id").notNull().references(() => media.id) }, (t) => [primaryKey({ columns: [t.articleId, t.mediaId] })]);
export const publicationMedia = pgTable("publication_media", { articleId: uuid("article_id").notNull().references(() => articlePublications.articleId), mediaId: uuid("media_id").notNull().references(() => media.id) }, (t) => [primaryKey({ columns: [t.articleId, t.mediaId] })]);
export const reviewMedia = pgTable("review_media", { reviewId: uuid("review_id").notNull().references(() => reviewRequests.id), mediaId: uuid("media_id").notNull().references(() => media.id) }, (t) => [primaryKey({ columns: [t.reviewId, t.mediaId] })]);

export const idempotencyKeys = pgTable("idempotency_keys", {
  actorId: uuid("actor_id").notNull().references(() => users.id), operation: varchar("operation", { length: 64 }).notNull(), key: uuid("key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(),
  result: jsonb("result").$type<{ resourceId: string; version?: number }>(), createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.actorId, t.operation, t.key] })]);

export const domainEvents = pgTable("domain_events", {
  id: id(), type: varchar("type", { length: 64 }).notNull(), payload: jsonb("payload").$type<Record<string, string>>().notNull(), createdAt: createdAt(),
});

export const jobs = pgTable("jobs", {
  id: id(), eventId: uuid("event_id").notNull().references(() => domainEvents.id), handler: varchar("handler", { length: 64 }).notNull(), status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(6), availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseToken: uuid("lease_token"), leaseUntil: timestamp("lease_until", { withTimezone: true }), lastErrorCode: varchar("last_error_code", { length: 64 }), completedAt: timestamp("completed_at", { withTimezone: true }), createdAt: createdAt(),
}, (t) => [uniqueIndex("jobs_event_handler_unique").on(t.eventId, t.handler), index("jobs_available_idx").on(t.availableAt, t.id).where(sql`${t.status} in ('pending','retry')`), index("jobs_expired_lease_idx").on(t.leaseUntil).where(sql`${t.status} = 'running'`), check("jobs_status_check", sql`${t.status} in ('pending','running','retry','completed','failed')`), check("jobs_attempts_check", sql`${t.attempts} >= 0 and ${t.maxAttempts} between 1 and 20 and ${t.attempts} <= ${t.maxAttempts}`), check("jobs_lease_check", sql`(${t.status} = 'running' and ${t.leaseToken} is not null and ${t.leaseUntil} is not null) or (${t.status} <> 'running' and ${t.leaseToken} is null and ${t.leaseUntil} is null)`)]);

export const jobReceipts = pgTable("job_receipts", { jobId: uuid("job_id").primaryKey().references(() => jobs.id), completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow() });

export const notifications = pgTable("notifications", {
  id: id(), recipientId: uuid("recipient_id").notNull().references(() => users.id), eventId: uuid("event_id").notNull().references(() => domainEvents.id),
  type: varchar("type", { length: 64 }).notNull(), targetId: uuid("target_id").notNull(), readAt: timestamp("read_at", { withTimezone: true }), createdAt: createdAt(),
}, (t) => [uniqueIndex("notifications_recipient_event_unique").on(t.recipientId, t.eventId), index("notifications_recipient_order_idx").on(t.recipientId, t.createdAt, t.id)]);

export const auditLogs = pgTable("audit_logs", { id: id(), actorId: uuid("actor_id").notNull().references(() => users.id), targetType: varchar("target_type", { length: 64 }).notNull(), targetId: uuid("target_id").notNull(), action: varchar("action", { length: 64 }).notNull(), reason: text("reason").notNull(), requestId: uuid("request_id").notNull(), createdAt: createdAt() }, (t) => [check("audit_reason_check", sql`length(btrim(${t.reason})) > 0`), index("audit_target_idx").on(t.targetId, t.createdAt)]);

CREATE TABLE "article_drafts" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" varchar(100) DEFAULT '' NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"summary" varchar(200) DEFAULT '' NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_version_check" CHECK ("article_drafts"."version" >= 1),
	CONSTRAINT "draft_body_length_check" CHECK (char_length("article_drafts"."markdown") <= 100000)
);
--> statement-breakpoint
CREATE TABLE "article_publications" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"source_draft_version" integer NOT NULL,
	"title" varchar(100) DEFAULT '' NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"summary" varchar(200) DEFAULT '' NOT NULL,
	"plain_text" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_fields_check" CHECK ("article_publications"."source_draft_version" >= 1 and length(btrim("article_publications"."title")) > 0 and length(btrim("article_publications"."markdown")) > 0 and char_length("article_publications"."markdown") <= 100000)
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"first_published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"takedown_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_status_check" CHECK ("articles"."status" in ('draft','published','taken_down','deleted')),
	CONSTRAINT "articles_version_check" CHECK ("articles"."state_version" >= 1),
	CONSTRAINT "articles_published_time_check" CHECK ("articles"."status" <> 'published' or "articles"."first_published_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" uuid NOT NULL,
	"action" varchar(64) NOT NULL,
	"reason" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_reason_check" CHECK (length(btrim("audit_logs"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "captcha_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"browser_binding_hash" varchar(64) NOT NULL,
	"purpose" text NOT NULL,
	"answer_hmac" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captcha_purpose_check" CHECK ("captcha_challenges"."purpose" in ('register','login')),
	CONSTRAINT "captcha_attempts_check" CHECK ("captcha_challenges"."attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_media" (
	"article_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	CONSTRAINT "draft_media_article_id_media_id_pk" PRIMARY KEY("article_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "draft_tags" (
	"article_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "draft_tags_article_id_tag_id_pk" PRIMARY KEY("article_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"actor_id" uuid NOT NULL,
	"operation" varchar(64) NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_actor_id_operation_key_pk" PRIMARY KEY("actor_id","operation","key")
);
--> statement-breakpoint
CREATE TABLE "job_receipts" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"handler" varchar(64) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 6 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"last_error_code" varchar(64),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('pending','running','retry','completed','failed')),
	CONSTRAINT "jobs_attempts_check" CHECK ("jobs"."attempts" >= 0 and "jobs"."max_attempts" between 1 and 20 and "jobs"."attempts" <= "jobs"."max_attempts"),
	CONSTRAINT "jobs_lease_check" CHECK (("jobs"."status" = 'running' and "jobs"."lease_token" is not null and "jobs"."lease_until" is not null) or ("jobs"."status" <> 'running' and "jobs"."lease_token" is null and "jobs"."lease_until" is null))
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"status" text DEFAULT 'staging' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_state_check" CHECK ("media"."status" in ('staging','ready','failed')),
	CONSTRAINT "media_size_check" CHECK ("media"."size" > 0 and "media"."size" <= 5242880),
	CONSTRAINT "media_mime_check" CHECK ("media"."mime" in ('image/jpeg','image/png','image/webp'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"target_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_media" (
	"article_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	CONSTRAINT "publication_media_article_id_media_id_pk" PRIMARY KEY("article_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "publication_tags" (
	"article_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "publication_tags_article_id_tag_id_pk" PRIMARY KEY("article_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"action" varchar(64) NOT NULL,
	"subject_hash" varchar(64) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_buckets_action_subject_hash_window_start_pk" PRIMARY KEY("action","subject_hash","window_start"),
	CONSTRAINT "rate_count_check" CHECK ("rate_limit_buckets"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "review_media" (
	"review_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	CONSTRAINT "review_media_review_id_media_id_pk" PRIMARY KEY("review_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"source_draft_version" integer NOT NULL,
	"title" varchar(100) DEFAULT '' NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"summary" varchar(200) DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_by" uuid NOT NULL,
	"decision_by" uuid,
	"reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_status_check" CHECK ("review_requests"."status" in ('pending','approved','rejected','withdrawn','terminated')),
	CONSTRAINT "review_fields_check" CHECK ("review_requests"."version" >= 1 and "review_requests"."source_draft_version" >= 1 and length(btrim("review_requests"."title")) > 0 and length(btrim("review_requests"."markdown")) > 0 and char_length("review_requests"."markdown") <= 100000)
);
--> statement-breakpoint
CREATE TABLE "review_tags" (
	"review_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "review_tags_review_id_tag_id_pk" PRIMARY KEY("review_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"csrf_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(40) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_normalized" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"nickname" varchar(30) NOT NULL,
	"bio" varchar(200) DEFAULT '' NOT NULL,
	"avatar_media_id" uuid,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'normal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('user','admin')),
	CONSTRAINT "users_status_check" CHECK ("users"."status" in ('normal','banned')),
	CONSTRAINT "users_nickname_check" CHECK (char_length("users"."nickname") between 2 and 30),
	CONSTRAINT "users_email_normalized_check" CHECK ("users"."email_normalized" = lower(btrim("users"."email_normalized")))
);
--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_publications" ADD CONSTRAINT "article_publications_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_media" ADD CONSTRAINT "draft_media_article_id_article_drafts_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "article_drafts"("article_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_media" ADD CONSTRAINT "draft_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_tags" ADD CONSTRAINT "draft_tags_article_id_article_drafts_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "article_drafts"("article_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_tags" ADD CONSTRAINT "draft_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_receipts" ADD CONSTRAINT "job_receipts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_event_id_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "domain_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_domain_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "domain_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_media" ADD CONSTRAINT "publication_media_article_id_article_publications_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "article_publications"("article_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_media" ADD CONSTRAINT "publication_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_tags" ADD CONSTRAINT "publication_tags_article_id_article_publications_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "article_publications"("article_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_tags" ADD CONSTRAINT "publication_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_review_id_review_requests_id_fk" FOREIGN KEY ("review_id") REFERENCES "review_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_decision_by_users_id_fk" FOREIGN KEY ("decision_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tags" ADD CONSTRAINT "review_tags_review_id_review_requests_id_fk" FOREIGN KEY ("review_id") REFERENCES "review_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tags" ADD CONSTRAINT "review_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_media_id_media_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_public_order_idx" ON "articles" USING btree ("first_published_at","id") WHERE "articles"."status" = 'published';--> statement-breakpoint
CREATE INDEX "articles_author_idx" ON "articles" USING btree ("author_id","status");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_logs" USING btree ("target_id","created_at");--> statement-breakpoint
CREATE INDEX "captcha_expiry_idx" ON "captcha_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_event_handler_unique" ON "jobs" USING btree ("event_id","handler");--> statement-breakpoint
CREATE INDEX "jobs_available_idx" ON "jobs" USING btree ("available_at","id") WHERE "jobs"."status" in ('pending','retry');--> statement-breakpoint
CREATE INDEX "jobs_expired_lease_idx" ON "jobs" USING btree ("lease_until") WHERE "jobs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "media_storage_key_unique" ON "media" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_recipient_event_unique" ON "notifications" USING btree ("recipient_id","event_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_order_idx" ON "notifications" USING btree ("recipient_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_one_pending" ON "review_requests" USING btree ("article_id") WHERE "review_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_expiry_idx" ON "sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_slug_unique" ON "tags" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email_normalized");
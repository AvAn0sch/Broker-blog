ALTER TABLE "media" ADD COLUMN "checksum" varchar(64);--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "upload_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "failure_code" varchar(64);--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "media_owner_order_idx" ON "media" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "media_staging_lease_idx" ON "media" USING btree ("upload_lease_until") WHERE "media"."status" = 'staging';--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_checksum_check" CHECK ("media"."checksum" is null or "media"."checksum" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_status_fields_check" CHECK (("media"."status" = 'staging' and "media"."upload_lease_until" is not null and "media"."checksum" is null) or ("media"."status" = 'ready' and "media"."upload_lease_until" is null and "media"."checksum" is not null) or ("media"."status" = 'failed' and "media"."upload_lease_until" is null and "media"."checksum" is null and "media"."failure_code" is not null));
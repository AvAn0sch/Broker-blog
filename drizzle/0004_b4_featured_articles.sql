CREATE TABLE "featured_articles" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"selected_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "featured_position_check" CHECK ("featured_articles"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "featured_articles" ADD CONSTRAINT "featured_articles_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "featured_articles" ADD CONSTRAINT "featured_articles_selected_by_users_id_fk" FOREIGN KEY ("selected_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "featured_order_idx" ON "featured_articles" USING btree ("position","article_id");
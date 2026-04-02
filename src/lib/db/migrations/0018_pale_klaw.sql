CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"s3_key" text NOT NULL,
	"is_image" boolean DEFAULT false NOT NULL,
	"thumbnail_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"content_html" text NOT NULL,
	"content_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_entity_idx" ON "activity_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "activity_events_created_at_idx" ON "activity_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "comments_entity_idx" ON "comments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "comments_created_at_idx" ON "comments" USING btree ("created_at");
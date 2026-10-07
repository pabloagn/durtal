CREATE TABLE "ebook_ingest_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source_host" text,
	"source_path" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"source_mtime" timestamp with time zone,
	"sha256" text,
	"format" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"ebook_id" uuid,
	"file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebook_ingest_items_run_path_unique" UNIQUE("run_id","source_path"),
	CONSTRAINT "ebook_ingest_items_state_check" CHECK ("ebook_ingest_items"."state" in ('pending', 'stored', 'registered', 'done', 'failed')),
	CONSTRAINT "ebook_ingest_items_outcome_check" CHECK ("ebook_ingest_items"."outcome" is null or "ebook_ingest_items"."outcome" in ('new_ebook', 'new_format', 'replaced_file', 'already_stored', 'duplicate_in_run', 'quarantined', 'ignored', 'changed_since_plan')),
	CONSTRAINT "ebook_ingest_items_format_check" CHECK ("ebook_ingest_items"."format" is null or "ebook_ingest_items"."format" in ('epub', 'kepub', 'pdf', 'mobi', 'azw', 'azw3', 'kfx', 'fb2', 'fbz', 'cbz', 'cbr', 'djvu', 'txt', 'rtf', 'docx', 'lit', 'chm', 'other'))
);
--> statement-breakpoint
CREATE TABLE "ebook_ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"host" text,
	"roots" text[] DEFAULT '{}'::text[] NOT NULL,
	"plan_sha256" text,
	"tool_version" integer NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reconciliation" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebook_ingest_runs_kind_check" CHECK ("ebook_ingest_runs"."kind" in ('apply', 'upload', 'verify')),
	CONSTRAINT "ebook_ingest_runs_state_check" CHECK ("ebook_ingest_runs"."state" in ('running', 'finished', 'interrupted', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "ebook_ingest_items" ADD CONSTRAINT "ebook_ingest_items_run_id_ebook_ingest_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ebook_ingest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_ingest_items" ADD CONSTRAINT "ebook_ingest_items_ebook_id_ebooks_id_fk" FOREIGN KEY ("ebook_id") REFERENCES "public"."ebooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_ingest_items" ADD CONSTRAINT "ebook_ingest_items_file_id_ebook_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."ebook_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ebook_ingest_items_run_state_idx" ON "ebook_ingest_items" USING btree ("run_id","state");--> statement-breakpoint
CREATE INDEX "ebook_ingest_items_sha256_idx" ON "ebook_ingest_items" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "ebook_ingest_runs_started_idx" ON "ebook_ingest_runs" USING btree ("started_at");
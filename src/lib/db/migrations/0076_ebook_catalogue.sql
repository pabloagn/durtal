CREATE TABLE "ebook_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ebook_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"style" text DEFAULT 'highlight' NOT NULL,
	"color" text,
	"locator" jsonb NOT NULL,
	"progression" real NOT NULL,
	"chapter" text,
	"text" text,
	"note" text,
	"anchor_state" text DEFAULT 'exact' NOT NULL,
	"device_id" text,
	"client_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ebook_annotations_kind_check" CHECK ("ebook_annotations"."kind" in ('highlight', 'bookmark')),
	CONSTRAINT "ebook_annotations_style_check" CHECK ("ebook_annotations"."style" in ('highlight', 'underline', 'quote')),
	CONSTRAINT "ebook_annotations_color_check" CHECK ("ebook_annotations"."color" is null or "ebook_annotations"."color" in ('ochre', 'sage', 'slate', 'rose', 'violet')),
	CONSTRAINT "ebook_annotations_anchor_state_check" CHECK ("ebook_annotations"."anchor_state" in ('exact', 'healed', 'approximate', 'orphaned')),
	CONSTRAINT "ebook_annotations_text_check" CHECK ("ebook_annotations"."text" is null or char_length("ebook_annotations"."text") <= 10000)
);
--> statement-breakpoint
CREATE TABLE "ebook_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ebook_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"format" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_type" text NOT NULL,
	"original_filename" text,
	"s3_key" text NOT NULL,
	"status" text NOT NULL,
	"verified_at" timestamp with time zone,
	"drm" text,
	"source_host" text,
	"source_path" text,
	"source_mtime" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"word_count" integer,
	"char_count" integer,
	"front_back_word_count" integer,
	"page_estimate" integer,
	"text_language" text,
	"text_tool_version" integer,
	"manifest_key" text,
	"cover_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebook_files_sha256_unique" UNIQUE("sha256"),
	CONSTRAINT "ebook_files_s3_key_unique" UNIQUE("s3_key"),
	CONSTRAINT "ebook_files_sha256_check" CHECK ("ebook_files"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "ebook_files_format_check" CHECK ("ebook_files"."format" in ('epub', 'kepub', 'pdf', 'mobi', 'azw', 'azw3', 'kfx', 'fb2', 'fbz', 'cbz', 'cbr', 'djvu', 'txt', 'rtf', 'docx', 'lit', 'chm', 'other')),
	CONSTRAINT "ebook_files_status_check" CHECK ("ebook_files"."status" in ('stored', 'verified', 'missing', 'quarantined', 'replaced'))
);
--> statement-breakpoint
CREATE TABLE "ebook_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ebook_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"device_label" text NOT NULL,
	"locator" jsonb NOT NULL,
	"progression" real NOT NULL,
	"furthest_progression" real NOT NULL,
	"chapter" text,
	"client_updated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebook_positions_file_device_unique" UNIQUE("file_id","device_id"),
	CONSTRAINT "ebook_positions_progression_check" CHECK ("ebook_positions"."progression" between 0 and 1 and "ebook_positions"."furthest_progression" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "ebooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"title_sort" text,
	"subtitle" text,
	"authors" text[] DEFAULT '{}'::text[] NOT NULL,
	"author_sort" text,
	"language" text,
	"isbns" text[] DEFAULT '{}'::text[] NOT NULL,
	"identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"series" text,
	"series_index" numeric,
	"publisher" text,
	"published_year" integer,
	"description" text,
	"cover_key" text,
	"preferred_file_id" uuid,
	"instance_id" uuid,
	"match_state" text DEFAULT 'pending' NOT NULL,
	"match_method" text,
	"match_probability" real,
	"matched_at" timestamp with time zone,
	"import_source" text NOT NULL,
	"import_ref" text,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebooks_instance_id_unique" UNIQUE("instance_id"),
	CONSTRAINT "ebooks_match_state_check" CHECK ("ebooks"."match_state" in ('pending', 'linked', 'standalone', 'excluded')),
	CONSTRAINT "ebooks_linked_check" CHECK (("ebooks"."match_state" = 'linked') = ("ebooks"."instance_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "calibre_books" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reading_progress" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "calibre_books" CASCADE;--> statement-breakpoint
DROP TABLE "reading_progress" CASCADE;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "ebook_location_id" uuid;--> statement-breakpoint
ALTER TABLE "ebook_annotations" ADD CONSTRAINT "ebook_annotations_ebook_id_ebooks_id_fk" FOREIGN KEY ("ebook_id") REFERENCES "public"."ebooks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_annotations" ADD CONSTRAINT "ebook_annotations_file_id_ebook_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."ebook_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_files" ADD CONSTRAINT "ebook_files_ebook_id_ebooks_id_fk" FOREIGN KEY ("ebook_id") REFERENCES "public"."ebooks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_positions" ADD CONSTRAINT "ebook_positions_ebook_id_ebooks_id_fk" FOREIGN KEY ("ebook_id") REFERENCES "public"."ebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_positions" ADD CONSTRAINT "ebook_positions_file_id_ebook_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."ebook_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_preferred_file_id_ebook_files_id_fk" FOREIGN KEY ("preferred_file_id") REFERENCES "public"."ebook_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ebook_annotations_ebook_idx" ON "ebook_annotations" USING btree ("ebook_id","deleted_at","progression");--> statement-breakpoint
CREATE INDEX "ebook_files_ebook_idx" ON "ebook_files" USING btree ("ebook_id");--> statement-breakpoint
CREATE INDEX "ebook_positions_ebook_updated_idx" ON "ebook_positions" USING btree ("ebook_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ebooks_import_ref_unique" ON "ebooks" USING btree ("import_source","import_ref") WHERE "ebooks"."import_ref" is not null;--> statement-breakpoint
CREATE INDEX "ebooks_isbns_idx" ON "ebooks" USING gin ("isbns");--> statement-breakpoint
CREATE INDEX "ebooks_search_text_trgm_idx" ON "ebooks" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_ebook_location_id_locations_id_fk" FOREIGN KEY ("ebook_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "calibre_id";--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "calibre_url";
--> statement-breakpoint
-- An e-book is a copy of a book only (SLN-490). A trigger, as a check cannot
-- look at the copy's work.
CREATE FUNCTION require_ebook_book_instance() RETURNS trigger AS $$
BEGIN
  IF NEW.instance_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM instances i
      JOIN editions e ON e.id = i.edition_id
      JOIN works w ON w.id = e.work_id
    WHERE i.id = NEW.instance_id AND w.kind = 'book'
  ) THEN
    RAISE EXCEPTION 'An eBook can only be a copy of a book'
      USING ERRCODE = '23514', CONSTRAINT = 'ebook_book_instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ebook_book_instance_required
  BEFORE INSERT OR UPDATE OF instance_id ON ebooks
  FOR EACH ROW EXECUTE FUNCTION require_ebook_book_instance();
--> statement-breakpoint
-- A copy that is deleted sets ebooks.instance_id to null; the e-book and its
-- files stay, and it waits to be matched again.
CREATE FUNCTION ebook_copy_removed() RETURNS trigger AS $$
BEGIN
  IF OLD.instance_id IS NOT NULL AND NEW.instance_id IS NULL AND NEW.match_state = 'linked' THEN
    NEW.match_state := 'pending';
    NEW.match_method := NULL;
    NEW.match_probability := NULL;
    NEW.matched_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ebook_copy_removed
  BEFORE UPDATE OF instance_id ON ebooks
  FOR EACH ROW EXECUTE FUNCTION ebook_copy_removed();
--> statement-breakpoint
INSERT INTO "app_settings" ("id", "ebook_location_id")
SELECT true, "id" FROM "locations" WHERE "name" = 'eBooks' AND "type" = 'digital'
ORDER BY "created_at", "id" LIMIT 1
ON CONFLICT ("id") DO UPDATE SET "ebook_location_id" = excluded."ebook_location_id";

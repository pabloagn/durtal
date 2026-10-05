CREATE TABLE "reading_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"reading_id" uuid,
	"edition_id" uuid,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"comment_html" text,
	"comment_json" jsonb,
	"page" integer,
	"chapter" text,
	"percent" numeric(5, 2),
	"is_favourite" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"import_id" uuid,
	"source_key" text,
	"search_text" text GENERATED ALWAYS AS (search_normalize(body || ' ' || coalesce(chapter, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_notes_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "reading_note_values_check" CHECK ("reading_notes"."kind" in ('quote','note') and "reading_notes"."source" in ('manual','reader','import')
        and length("reading_notes"."body") between 1 and 10000
        and ("reading_notes"."page" is null or "reading_notes"."page" >= 0)
        and ("reading_notes"."chapter" is null or length("reading_notes"."chapter") between 1 and 300)
        and ("reading_notes"."percent" is null or "reading_notes"."percent" between 0 and 100)),
	CONSTRAINT "reading_note_comment_check" CHECK ("reading_notes"."kind" = 'quote' or ("reading_notes"."comment_html" is null and "reading_notes"."comment_json" is null))
);
--> statement-breakpoint
ALTER TABLE "reading_import_rows" ADD COLUMN "note_decision" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_notes" ADD CONSTRAINT "reading_notes_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_notes" ADD CONSTRAINT "reading_notes_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_notes" ADD CONSTRAINT "reading_notes_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_notes" ADD CONSTRAINT "reading_notes_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reading_note_work_page_idx" ON "reading_notes" USING btree ("work_id","page");--> statement-breakpoint
CREATE INDEX "reading_note_created_idx" ON "reading_notes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reading_note_search_trgm_idx" ON "reading_notes" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "reading_note_reading_idx" ON "reading_notes" USING btree ("reading_id");--> statement-breakpoint
CREATE INDEX "reading_note_edition_idx" ON "reading_notes" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "reading_note_import_idx" ON "reading_notes" USING btree ("import_id");--> statement-breakpoint
ALTER TABLE "reading_import_rows" ADD CONSTRAINT "reading_import_rows_note_decision_check" CHECK ("reading_import_rows"."note_decision" in ('pending','import','skip'));--> statement-breakpoint
CREATE TRIGGER book_parent_required BEFORE INSERT OR UPDATE OF work_id ON reading_notes FOR EACH ROW EXECUTE FUNCTION require_book_parent();
--> statement-breakpoint
CREATE FUNCTION guard_reading_note() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The audited book merge moves reading_notes before readings: for a moment
  -- the note is on the target while its reading is still on the source
  IF TG_OP = 'UPDATE' AND NEW.work_id IS DISTINCT FROM OLD.work_id
     AND NEW.reading_id IS NOT DISTINCT FROM OLD.reading_id
     AND harmonization_allows_move('works', OLD.work_id, NEW.work_id) THEN
    RETURN NEW;
  END IF;
  -- Only a new or changed reference, or a moved note, is checked: clearing
  -- one (a reading, edition or import delete) never raises
  IF NEW.edition_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.edition_id IS DISTINCT FROM OLD.edition_id OR NEW.work_id IS DISTINCT FROM OLD.work_id) THEN
    IF NOT EXISTS (SELECT 1 FROM editions e WHERE e.id = NEW.edition_id AND e.work_id = NEW.work_id) THEN
      RAISE EXCEPTION 'This edition belongs to another book' USING ERRCODE = '23514', CONSTRAINT = 'reading_note_edition_work';
    END IF;
  END IF;
  IF NEW.reading_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.reading_id IS DISTINCT FROM OLD.reading_id OR NEW.work_id IS DISTINCT FROM OLD.work_id) THEN
    IF NOT EXISTS (SELECT 1 FROM readings r WHERE r.id = NEW.reading_id AND r.work_id = NEW.work_id) THEN
      RAISE EXCEPTION 'This reading belongs to another book' USING ERRCODE = '23514', CONSTRAINT = 'reading_note_reading_work';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reading_note_guard BEFORE INSERT OR UPDATE ON reading_notes FOR EACH ROW EXECUTE FUNCTION guard_reading_note();

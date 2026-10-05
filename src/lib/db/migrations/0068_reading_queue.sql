CREATE TABLE "reading_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"edition_id" uuid,
	"position" integer NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"import_id" uuid,
	"source_key" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_queue_work_id_unique" UNIQUE("work_id"),
	CONSTRAINT "reading_queue_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "reading_queue_source_check" CHECK ("reading_queue"."source" in ('manual','import','suggestion')),
	CONSTRAINT "reading_queue_note_check" CHECK ("reading_queue"."note" is null or length("reading_queue"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "reading_queue" ADD CONSTRAINT "reading_queue_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_queue" ADD CONSTRAINT "reading_queue_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_queue" ADD CONSTRAINT "reading_queue_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reading_queue_position_idx" ON "reading_queue" USING btree ("position");--> statement-breakpoint
CREATE TRIGGER book_parent_required BEFORE INSERT OR UPDATE OF work_id ON reading_queue FOR EACH ROW EXECUTE FUNCTION require_book_parent();
--> statement-breakpoint
CREATE FUNCTION guard_reading_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only a new or changed edition, or a moved row, is checked: clearing the
  -- edition (an edition delete) and a renumber of positions never raise
  IF NEW.edition_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.edition_id IS DISTINCT FROM OLD.edition_id OR NEW.work_id IS DISTINCT FROM OLD.work_id) THEN
    IF NOT EXISTS (SELECT 1 FROM editions e WHERE e.id = NEW.edition_id AND e.work_id = NEW.work_id) THEN
      RAISE EXCEPTION 'This edition belongs to another book' USING ERRCODE = '23514', CONSTRAINT = 'reading_queue_edition_work';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reading_queue_guard BEFORE INSERT OR UPDATE ON reading_queue FOR EACH ROW EXECUTE FUNCTION guard_reading_queue();

ALTER TABLE "reading_notes" ADD COLUMN "end_page" integer;--> statement-breakpoint
ALTER TABLE "reading_notes" ADD COLUMN "page_roman" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_notes" ADD CONSTRAINT "reading_note_page_range_check" CHECK (("reading_notes"."end_page" is null or ("reading_notes"."page" is not null and "reading_notes"."end_page" > "reading_notes"."page"))
        and (not "reading_notes"."page_roman" or ("reading_notes"."page" is not null and "reading_notes"."page" >= 1)));--> statement-breakpoint
-- An imported note on a reading takes that reading's edition (SLN-480); updated_at is left alone, so the import's undo still sees it unedited
update reading_notes n set edition_id = r.edition_id
from readings r
where n.reading_id = r.id and n.edition_id is null
  and r.edition_id is not null and n.source = 'import'
  and exists (select 1 from editions e where e.id = r.edition_id and e.work_id = n.work_id);

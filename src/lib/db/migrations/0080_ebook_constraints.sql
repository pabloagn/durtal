ALTER TABLE "ebook_annotations" DROP CONSTRAINT "ebook_annotations_file_id_ebook_files_id_fk";
--> statement-breakpoint
ALTER TABLE "ebook_positions" DROP CONSTRAINT "ebook_positions_file_id_ebook_files_id_fk";
--> statement-breakpoint
ALTER TABLE "ebook_files" ADD CONSTRAINT "ebook_files_id_ebook_unique" UNIQUE("id","ebook_id");--> statement-breakpoint
ALTER TABLE "ebook_annotations" ADD CONSTRAINT "ebook_annotations_file_ebook_fk" FOREIGN KEY ("file_id","ebook_id") REFERENCES "public"."ebook_files"("id","ebook_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_positions" ADD CONSTRAINT "ebook_positions_file_ebook_fk" FOREIGN KEY ("file_id","ebook_id") REFERENCES "public"."ebook_files"("id","ebook_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_files" ADD CONSTRAINT "ebook_files_drm_check" CHECK ("ebook_files"."drm" is null or "ebook_files"."drm" in ('adobe-adept', 'kindle', 'readium-lcp', 'apple-fairplay', 'pdf-password', 'unknown'));--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_import_source_check" CHECK ("ebooks"."import_source" in ('folder', 'upload'));--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_match_method_check" CHECK ("ebooks"."match_method" is null or "ebooks"."match_method" in ('isbn', 'identifier', 'score', 'manual', 'accession'));--> statement-breakpoint
-- Written by hand (SLN-518): Drizzle cannot declare a set-null that clears one column of a
-- composite key. The preferred file is one of the e-book's own files; deleting the file clears
-- preferred_file_id only. Needs PostgreSQL 15 or later. The unique above must come before the keys.
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_preferred_file_ebook_fk" FOREIGN KEY ("preferred_file_id","id") REFERENCES "public"."ebook_files"("id","ebook_id") ON DELETE SET NULL ("preferred_file_id");

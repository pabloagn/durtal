CREATE TABLE "reading_import_rows" (
	"import_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"data" jsonb NOT NULL,
	"match" jsonb,
	"decision" text DEFAULT 'pending' NOT NULL,
	"use_file_rating" boolean DEFAULT false NOT NULL,
	"work_id" uuid,
	"written" jsonb,
	CONSTRAINT "reading_import_rows_import_id_row_no_pk" PRIMARY KEY("import_id","row_no"),
	CONSTRAINT "reading_import_rows_decision_check" CHECK ("reading_import_rows"."decision" in ('pending','import','skip'))
);
--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "reading_import_rows" ADD CONSTRAINT "reading_import_rows_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_import_rows" ADD CONSTRAINT "reading_import_rows_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reading_import_rows_work_idx" ON "reading_import_rows" USING btree ("work_id");--> statement-breakpoint
CREATE TRIGGER book_parent_required BEFORE INSERT OR UPDATE OF work_id ON reading_import_rows FOR EACH ROW EXECUTE FUNCTION require_book_parent();

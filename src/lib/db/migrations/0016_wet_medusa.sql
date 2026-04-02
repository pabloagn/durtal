CREATE TABLE "calibre_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calibre_id" integer NOT NULL,
	"calibre_uuid" text,
	"title" text NOT NULL,
	"author_sort" text,
	"path" text NOT NULL,
	"has_cover" boolean DEFAULT false NOT NULL,
	"isbn" text,
	"formats" jsonb,
	"pubdate" text,
	"work_id" uuid,
	"last_synced" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calibre_book_id" uuid NOT NULL,
	"current_cfi" text,
	"current_page" integer,
	"progress_percent" real,
	"current_chapter" text,
	"total_reading_seconds" integer DEFAULT 0,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"bookmarks" jsonb,
	"reader_settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_progress_calibre_book_id_unique" UNIQUE("calibre_book_id")
);
--> statement-breakpoint
ALTER TABLE "calibre_books" ADD CONSTRAINT "calibre_books_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_calibre_book_id_calibre_books_id_fk" FOREIGN KEY ("calibre_book_id") REFERENCES "public"."calibre_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calibre_books_calibre_id_idx" ON "calibre_books" USING btree ("calibre_id");
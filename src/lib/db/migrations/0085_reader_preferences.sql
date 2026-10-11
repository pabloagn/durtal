CREATE TABLE "reader_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_class" text NOT NULL,
	"ebook_id" uuid,
	"presentation" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reader_preferences_scope_unique" UNIQUE NULLS NOT DISTINCT("device_class","ebook_id"),
	CONSTRAINT "reader_preferences_device_class_check" CHECK ("reader_preferences"."device_class" in ('phone', 'tablet', 'desktop'))
);
--> statement-breakpoint
ALTER TABLE "reader_preferences" ADD CONSTRAINT "reader_preferences_ebook_id_ebooks_id_fk" FOREIGN KEY ("ebook_id") REFERENCES "public"."ebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reader_preferences_ebook_id_idx" ON "reader_preferences" USING btree ("ebook_id");
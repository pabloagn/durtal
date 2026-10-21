CREATE TABLE "edition_cover_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"cover_s3_key" text,
	"thumbnail_s3_key" text,
	"cover_source_url" text,
	"original_s3_key" text,
	"applied_crop" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edition_cover_history_choice_unique" UNIQUE NULLS NOT DISTINCT("edition_id","cover_s3_key","thumbnail_s3_key"),
	CONSTRAINT "edition_cover_history_image_check" CHECK ("edition_cover_history"."cover_s3_key" is not null or "edition_cover_history"."thumbnail_s3_key" is not null)
);
--> statement-breakpoint
ALTER TABLE "edition_cover_history" ADD CONSTRAINT "edition_cover_history_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edition_cover_history_edition_idx" ON "edition_cover_history" USING btree ("edition_id","created_at");
--> statement-breakpoint
-- Preserve committed legacy choices without changing any edition or image.
INSERT INTO public.edition_cover_history
  (edition_id,cover_s3_key,thumbnail_s3_key,cover_source_url,created_at)
SELECT id,cover_s3_key,thumbnail_s3_key,cover_source_url,updated_at FROM public.editions
WHERE cover_s3_key IS NOT NULL OR thumbnail_s3_key IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION public.record_edition_cover_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.cover_s3_key IS NOT NULL OR OLD.thumbnail_s3_key IS NOT NULL) THEN
    INSERT INTO public.edition_cover_history(edition_id,cover_s3_key,thumbnail_s3_key,cover_source_url)
    VALUES(OLD.id,OLD.cover_s3_key,OLD.thumbnail_s3_key,OLD.cover_source_url)
    ON CONFLICT ON CONSTRAINT edition_cover_history_choice_unique DO NOTHING;
  END IF;
  IF NEW.cover_s3_key IS NOT NULL OR NEW.thumbnail_s3_key IS NOT NULL THEN
    INSERT INTO public.edition_cover_history(edition_id,cover_s3_key,thumbnail_s3_key,cover_source_url)
    VALUES(NEW.id,NEW.cover_s3_key,NEW.thumbnail_s3_key,NEW.cover_source_url)
    ON CONFLICT ON CONSTRAINT edition_cover_history_choice_unique DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER edition_cover_history_publication
AFTER INSERT OR UPDATE OF cover_s3_key,thumbnail_s3_key,cover_source_url ON public.editions
FOR EACH ROW EXECUTE FUNCTION public.record_edition_cover_history();

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM media WHERE type NOT IN ('poster','background','gallery') OR (collection_id IS NOT NULL AND type='gallery')) THEN
  RAISE EXCEPTION 'Resolve media rows with an unknown type or a collection gallery before migration; no media were changed';
 END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "media" DROP CONSTRAINT "media_owner_check";--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "art_object_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "perfume_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "alt_text" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "credit" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "license" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "license_url" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "source_record_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_organization_id_publishing_houses_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."publishing_houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_art_object_id_art_objects_id_fk" FOREIGN KEY ("art_object_id") REFERENCES "public"."art_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_perfume_variant_id_perfume_variants_id_fk" FOREIGN KEY ("perfume_variant_id") REFERENCES "public"."perfume_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_organization_id_type_active_idx" ON "media" USING btree ("organization_id","type","is_active");--> statement-breakpoint
CREATE INDEX "media_art_object_id_type_active_idx" ON "media" USING btree ("art_object_id","type","is_active");--> statement-breakpoint
CREATE INDEX "media_perfume_variant_id_type_active_idx" ON "media" USING btree ("perfume_variant_id","type","is_active");--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_type_check" CHECK ("media"."type" in ('poster','background','gallery')
  and not ("media"."collection_id" is not null and "media"."type"='gallery')
  and not (("media"."organization_id" is not null or "media"."art_object_id" is not null or "media"."perfume_variant_id" is not null) and "media"."type"='background'));--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_attribution_check" CHECK (("media"."alt_text" is null or length(trim("media"."alt_text")) between 1 and 1000)
        and ("media"."credit" is null or length(trim("media"."credit")) between 1 and 500)
        and ("media"."license" is null or length(trim("media"."license")) between 1 and 200)
        and ("media"."license_url" is null or (length("media"."license_url") <= 4000 and "media"."license_url" ~ '^https?://[^[:space:]@/]+([/:?#][^[:space:]]*)?$'))
        and ("media"."source_url" is null or (length("media"."source_url") <= 4000 and "media"."source_url" ~ '^https?://[^[:space:]@/]+([/:?#][^[:space:]]*)?$')));--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_check" CHECK (num_nonnulls("media"."work_id", "media"."author_id", "media"."collection_id", "media"."organization_id", "media"."art_object_id", "media"."perfume_variant_id") = 1);
--> statement-breakpoint
CREATE FUNCTION guard_media_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_work uuid;
BEGIN
 IF NEW.source_record_id IS NULL THEN RETURN NEW; END IF;
 owner_work := coalesce(NEW.work_id,
   (SELECT work_id FROM art_objects WHERE id=NEW.art_object_id),
   (SELECT work_id FROM perfume_variants WHERE id=NEW.perfume_variant_id));
 IF NOT EXISTS(SELECT 1 FROM source_records s WHERE s.id=NEW.source_record_id AND (
      (owner_work IS NOT NULL AND s.work_id=owner_work)
   OR (NEW.author_id IS NOT NULL AND s.person_id=NEW.author_id)
   OR (NEW.organization_id IS NOT NULL AND s.organization_id=NEW.organization_id))) THEN
   RAISE EXCEPTION 'The image source must belong to the same record as the image';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_source_guard BEFORE INSERT OR UPDATE OF source_record_id ON media FOR EACH ROW EXECUTE FUNCTION guard_media_source();

ALTER TABLE "media" DROP CONSTRAINT "media_type_check";--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_type_check" CHECK ("media"."type" in ('poster','background','gallery')
  and not ("media"."collection_id" is not null and "media"."type"='gallery')
  and not (("media"."art_object_id" is not null or "media"."perfume_variant_id" is not null) and "media"."type"='background'));
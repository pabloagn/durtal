ALTER TABLE "media" DROP CONSTRAINT "media_owner_check";--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "collection_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_owner_check" CHECK (num_nonnulls("media"."work_id", "media"."author_id", "media"."collection_id") = 1);--> statement-breakpoint
CREATE INDEX "media_collection_id_type_active_idx" ON "media" USING btree ("collection_id","type","is_active");--> statement-breakpoint
-- Move collection artwork into media before the old columns go.
-- Active poster: the poster column, or the legacy cover when there is no poster.
INSERT INTO "media" ("collection_id", "type", "s3_key", "thumbnail_s3_key", "mime_type", "is_active", "sort_order")
SELECT "id", 'poster', COALESCE("poster_s3_key", "cover_s3_key"),
  CASE WHEN "poster_s3_key" IS NOT NULL THEN "poster_thumbnail_s3_key" END,
  'image/webp', true, 0
FROM "collections"
WHERE COALESCE("poster_s3_key", "cover_s3_key") IS NOT NULL;--> statement-breakpoint
-- A distinct legacy cover next to a poster is kept as an inactive poster.
INSERT INTO "media" ("collection_id", "type", "s3_key", "mime_type", "is_active", "sort_order")
SELECT "id", 'poster', "cover_s3_key", 'image/webp', false, 1
FROM "collections"
WHERE "poster_s3_key" IS NOT NULL AND "cover_s3_key" IS NOT NULL AND "cover_s3_key" <> "poster_s3_key";--> statement-breakpoint
INSERT INTO "media" ("collection_id", "type", "s3_key", "mime_type", "is_active", "sort_order")
SELECT "id", 'background', "background_s3_key", 'image/webp', true, 0
FROM "collections"
WHERE "background_s3_key" IS NOT NULL;--> statement-breakpoint
-- Keep saved brightness/contrast on the new rows (the adjustment records stay keyed by S3 key).
UPDATE "media" SET
  "brightness" = COALESCE(("image_adjustments"."settings"->>'brightness')::real, "media"."brightness"),
  "contrast" = COALESCE(("image_adjustments"."settings"->>'contrast')::real, "media"."contrast")
FROM "image_adjustments"
WHERE "media"."collection_id" IS NOT NULL AND "image_adjustments"."asset_key" = "media"."s3_key";--> statement-breakpoint
ALTER TABLE "collections" DROP COLUMN "cover_s3_key";--> statement-breakpoint
ALTER TABLE "collections" DROP COLUMN "poster_s3_key";--> statement-breakpoint
ALTER TABLE "collections" DROP COLUMN "poster_thumbnail_s3_key";--> statement-breakpoint
ALTER TABLE "collections" DROP COLUMN "background_s3_key";

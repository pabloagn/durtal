ALTER TABLE "media" ADD COLUMN "uncropped_s3_key" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "applied_crop" jsonb;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_applied_crop_check" CHECK (num_nonnulls("media"."uncropped_s3_key", "media"."applied_crop") in (0, 2));
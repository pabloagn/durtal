ALTER TABLE "media" ADD COLUMN "crop_x" real DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "crop_y" real DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "crop_zoom" real DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "original_s3_key" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "processing_params" jsonb;
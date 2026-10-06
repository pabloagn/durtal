ALTER TABLE "editions" ADD COLUMN "cover_palette" jsonb;--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "cover_color_bucket" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "color_bucket" text;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_cover_color_bucket_check" CHECK ("editions"."cover_color_bucket" is null or "editions"."cover_color_bucket" in ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'beige', 'white', 'grey', 'black'));--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_color_bucket_check" CHECK ("media"."color_bucket" is null or "media"."color_bucket" in ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'beige', 'white', 'grey', 'black'));
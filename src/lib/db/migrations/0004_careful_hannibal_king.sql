ALTER TABLE "authors" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "authors" ADD CONSTRAINT "authors_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_slug_unique" UNIQUE("slug");
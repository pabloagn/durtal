ALTER TABLE "works" DROP CONSTRAINT "works_kind_enabled_check";--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_kind_enabled_check" CHECK ("works"."kind" IN ('book', 'perfume'));
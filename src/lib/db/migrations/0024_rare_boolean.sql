ALTER TABLE "works" DROP CONSTRAINT "works_hunt_assessment_check";--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "is_rare" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "works" SET "is_rare" = ("hunt_difficulty" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "works" DROP COLUMN "hunt_difficulty";--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_hunt_assessment_check" CHECK ((
    (NOT "works"."is_rare" AND "works"."hunt_assessed_on" IS NULL)
    OR ("works"."is_rare" AND "works"."hunt_assessed_on" IS NOT NULL)
  ));
ALTER TABLE "works" ADD COLUMN "hunt_difficulty" text;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "hunt_assessed_on" date;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_hunt_assessment_check" CHECK ((
    ("works"."hunt_difficulty" IS NULL AND "works"."hunt_assessed_on" IS NULL)
    OR ("works"."hunt_difficulty" IS NOT NULL AND "works"."hunt_difficulty" IN ('rare', 'difficult_to_hunt') AND "works"."hunt_assessed_on" IS NOT NULL)
  ));
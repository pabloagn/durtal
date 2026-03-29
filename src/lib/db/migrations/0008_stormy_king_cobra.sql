CREATE TABLE "work_recommenders" (
	"work_id" uuid NOT NULL,
	"recommender_id" uuid NOT NULL,
	CONSTRAINT "work_recommenders_work_id_recommender_id_pk" PRIMARY KEY("work_id","recommender_id")
);
--> statement-breakpoint
-- Data migration: copy existing recommender_id values into the join table
INSERT INTO "work_recommenders" ("work_id", "recommender_id")
SELECT "id", "recommender_id" FROM "works" WHERE "recommender_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "works" DROP CONSTRAINT "works_recommender_id_recommenders_id_fk";
--> statement-breakpoint
ALTER TABLE "work_recommenders" ADD CONSTRAINT "work_recommenders_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_recommenders" ADD CONSTRAINT "work_recommenders_recommender_id_recommenders_id_fk" FOREIGN KEY ("recommender_id") REFERENCES "public"."recommenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" DROP COLUMN "recommender_id";
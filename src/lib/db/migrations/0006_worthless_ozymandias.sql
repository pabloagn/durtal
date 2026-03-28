CREATE TABLE "recommenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommenders_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "recommender_id" uuid;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_recommender_id_recommenders_id_fk" FOREIGN KEY ("recommender_id") REFERENCES "public"."recommenders"("id") ON DELETE set null ON UPDATE no action;
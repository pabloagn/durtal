CREATE TABLE "reading_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" smallint NOT NULL,
	"metric" text NOT NULL,
	"target" integer NOT NULL,
	"count_rereads" boolean DEFAULT true NOT NULL,
	"excluded_work_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_goal_values_check" CHECK ("reading_goals"."year" between 1900 and 2200 and "reading_goals"."metric" in ('books','pages','hours') and "reading_goals"."target" between 1 and 100000)
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "reading_rhythm_days" smallint;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_goal_year_metric_unique" ON "reading_goals" USING btree ("year","metric");--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_reading_rhythm_days_check" CHECK ("app_settings"."reading_rhythm_days" is null or "app_settings"."reading_rhythm_days" between 1 and 7);
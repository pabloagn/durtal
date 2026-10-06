CREATE TABLE "recommendation_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"until" date,
	"source" text DEFAULT 'suggestions' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_feedback_work_id_unique" UNIQUE("work_id"),
	CONSTRAINT "recommendation_feedback_values_check" CHECK ("recommendation_feedback"."verdict" in ('not_now','never','rejected') and "recommendation_feedback"."source" in ('suggestions','agent','enrichment')
        and "recommendation_feedback"."reasons" <@ array['too_long','too_short','not_in_the_mood','prose','genre','too_popular','already_read','other']::text[]
        and ("recommendation_feedback"."note" is null or length("recommendation_feedback"."note") <= 500))
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "reading_suggest_hide_anathema" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "reading_prediction_gate" jsonb;--> statement-breakpoint
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER book_parent_required BEFORE INSERT OR UPDATE OF work_id ON recommendation_feedback FOR EACH ROW EXECUTE FUNCTION require_book_parent();

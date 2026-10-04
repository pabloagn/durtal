CREATE TABLE "reading_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reading_id" uuid NOT NULL,
	"edition_id" uuid,
	"format" text NOT NULL,
	"read_on" date NOT NULL,
	"time_zone" text NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"start_page" integer,
	"end_page" integer,
	"start_percent" numeric(5, 2),
	"end_percent" numeric(5, 2),
	"start_minutes" integer,
	"end_minutes" integer,
	"end_chapter" text,
	"pages_total" integer,
	"pages_read" integer GENERATED ALWAYS AS (case when start_page is not null and end_page is not null then greatest(end_page - start_page, 0) end) STORED,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_session_values_check" CHECK ("reading_sessions"."format" in ('print','ebook','audio') and "reading_sessions"."source" in ('manual','timer','reader','import')
        and ("reading_sessions"."ended_at" is null or "reading_sessions"."started_at" is null or "reading_sessions"."ended_at" >= "reading_sessions"."started_at")
        and ("reading_sessions"."duration_seconds" is null or "reading_sessions"."duration_seconds" between 1 and 86400)
        and ("reading_sessions"."start_page" is null or "reading_sessions"."start_page" >= 0) and ("reading_sessions"."end_page" is null or "reading_sessions"."end_page" >= 0)
        and ("reading_sessions"."start_percent" is null or "reading_sessions"."start_percent" between 0 and 100)
        and ("reading_sessions"."end_percent" is null or "reading_sessions"."end_percent" between 0 and 100)
        and ("reading_sessions"."start_minutes" is null or "reading_sessions"."start_minutes" >= 0) and ("reading_sessions"."end_minutes" is null or "reading_sessions"."end_minutes" >= 0)
        and ("reading_sessions"."pages_total" is null or "reading_sessions"."pages_total" > 0)
        and ("reading_sessions"."end_chapter" is null or length("reading_sessions"."end_chapter") <= 300)
        and ("reading_sessions"."note" is null or length("reading_sessions"."note") <= 2000))
);
--> statement-breakpoint
CREATE TABLE "reading_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reading_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "reading_status_history_values_check" CHECK (("reading_status_history"."from_status" is null or "reading_status_history"."from_status" in ('reading','paused','finished','abandoned')) and "reading_status_history"."to_status" in ('reading','paused','finished','abandoned'))
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"edition_id" uuid,
	"instance_id" uuid,
	"location_id" uuid,
	"format" text DEFAULT 'print' NOT NULL,
	"status" text DEFAULT 'reading' NOT NULL,
	"started_on" date,
	"started_precision" text NOT NULL,
	"finished_on" date,
	"finished_precision" text DEFAULT 'unknown' NOT NULL,
	"unit" text DEFAULT 'pages' NOT NULL,
	"total_pages" integer,
	"total_minutes" integer,
	"start_page" integer,
	"start_percent" numeric(5, 2),
	"start_minutes" integer,
	"current_page" integer,
	"current_percent" numeric(5, 2),
	"current_minutes" integer,
	"current_chapter" text,
	"last_read_at" timestamp with time zone,
	"rating" numeric(2, 1),
	"review_html" text,
	"review_json" jsonb,
	"abandon_reason" text,
	"abandon_note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"import_id" uuid,
	"source_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readings_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "reading_values_check" CHECK ("readings"."format" in ('print','ebook','audio') and "readings"."status" in ('reading','paused','finished','abandoned')
        and "readings"."started_precision" in ('day','month','year','unknown') and "readings"."finished_precision" in ('day','month','year','unknown')
        and "readings"."unit" in ('pages','percent','minutes') and "readings"."source" in ('manual','reader','import','backfill')
        and ("readings"."abandon_reason" is null or "readings"."abandon_reason" in ('lost_interest','prose','content','edition','translation','superseded','other'))),
	CONSTRAINT "reading_precision_check" CHECK (("readings"."started_on" is null) = ("readings"."started_precision" = 'unknown') and ("readings"."finished_on" is null) = ("readings"."finished_precision" = 'unknown')),
	CONSTRAINT "reading_status_dates_check" CHECK ("readings"."status" not in ('reading','paused') or ("readings"."finished_on" is null and "readings"."finished_precision" = 'unknown')),
	CONSTRAINT "reading_abandon_check" CHECK ("readings"."status" = 'abandoned' or ("readings"."abandon_reason" is null and "readings"."abandon_note" is null)),
	CONSTRAINT "reading_position_check" CHECK (("readings"."total_pages" is null or "readings"."total_pages" > 0) and ("readings"."total_minutes" is null or "readings"."total_minutes" > 0)
        and ("readings"."start_page" is null or ("readings"."start_page" >= 0 and ("readings"."total_pages" is null or "readings"."start_page" <= "readings"."total_pages")))
        and ("readings"."current_page" is null or ("readings"."current_page" >= 0 and ("readings"."total_pages" is null or "readings"."current_page" <= "readings"."total_pages")))
        and ("readings"."start_minutes" is null or ("readings"."start_minutes" >= 0 and ("readings"."total_minutes" is null or "readings"."start_minutes" <= "readings"."total_minutes")))
        and ("readings"."current_minutes" is null or ("readings"."current_minutes" >= 0 and ("readings"."total_minutes" is null or "readings"."current_minutes" <= "readings"."total_minutes")))
        and ("readings"."start_percent" is null or "readings"."start_percent" between 0 and 100)
        and ("readings"."current_percent" is null or "readings"."current_percent" between 0 and 100)
        and ("readings"."current_chapter" is null or length("readings"."current_chapter") between 1 and 300)),
	CONSTRAINT "reading_rating_check" CHECK ("readings"."rating" is null or ("readings"."rating" >= 0.5 and "readings"."rating" <= 5 and "readings"."rating" * 2 = trunc("readings"."rating" * 2))),
	CONSTRAINT "reading_note_check" CHECK ("readings"."abandon_note" is null or length("readings"."abandon_note") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "works" ALTER COLUMN "rating" SET DATA TYPE numeric(2, 1);--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_status_history" ADD CONSTRAINT "reading_status_history_reading_id_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_session_timer_unique" ON "reading_sessions" USING btree ((true)) WHERE "reading_sessions"."source" = 'timer' and "reading_sessions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "reading_session_reading_idx" ON "reading_sessions" USING btree ("reading_id","read_on");--> statement-breakpoint
CREATE INDEX "reading_session_day_idx" ON "reading_sessions" USING btree ("read_on");--> statement-breakpoint
CREATE INDEX "reading_session_edition_idx" ON "reading_sessions" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "reading_status_history_reading_idx" ON "reading_status_history" USING btree ("reading_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_open_unique" ON "readings" USING btree ("work_id") WHERE "readings"."status" in ('reading','paused');--> statement-breakpoint
CREATE INDEX "reading_work_idx" ON "readings" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "reading_status_idx" ON "readings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reading_finished_idx" ON "readings" USING btree ("finished_on");--> statement-breakpoint
CREATE INDEX "reading_last_read_idx" ON "readings" USING btree ("last_read_at");--> statement-breakpoint
CREATE INDEX "reading_import_idx" ON "readings" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "reading_edition_idx" ON "readings" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "reading_instance_idx" ON "readings" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "reading_location_idx" ON "readings" USING btree ("location_id");--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_rating_check" CHECK ("works"."rating" IS NULL OR ("works"."rating" >= 0.5 AND "works"."rating" <= 5 AND "works"."rating" * 2 = trunc("works"."rating" * 2)));--> statement-breakpoint
-- SLN-444, custom part (drizzle-kit does not model functions or triggers).
-- The last day of a month or year date; the stored date is already the
-- period's first day. Built-ins only, so a restore with an empty search path
-- can evaluate it (changelog 0185).
CREATE FUNCTION public.reading_period_end(d date, p text) RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'year' THEN (d + interval '1 year')::date - 1
    WHEN 'month' THEN (d + interval '1 month')::date - 1
    ELSE d
  END
$$;
--> statement-breakpoint
-- The finish period ends on or after the start: a 14 Apr 2019 start accepts
-- "Apr 2019" and "2019", not "Mar 2019"
ALTER TABLE "readings" ADD CONSTRAINT "reading_dates_check" CHECK (
  finished_on IS NULL OR started_on IS NULL OR public.reading_period_end(finished_on, finished_precision) >= started_on
);
--> statement-breakpoint
CREATE TRIGGER book_parent_required BEFORE INSERT OR UPDATE OF work_id ON readings FOR EACH ROW EXECUTE FUNCTION require_book_parent();
--> statement-breakpoint
-- References are checked only when set and new or changed. Deleting an
-- edition sets it null on readings (an UPDATE that fires this trigger) while
-- its copies may still be set, so a null edition clears the copy, and an
-- update that only sets references to null never raises.
CREATE FUNCTION guard_reading() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.edition_id IS NULL THEN
    NEW.instance_id := NULL;
  END IF;
  IF NEW.edition_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.edition_id IS DISTINCT FROM OLD.edition_id OR NEW.work_id IS DISTINCT FROM OLD.work_id) THEN
    IF NOT EXISTS (SELECT 1 FROM editions WHERE id = NEW.edition_id AND work_id = NEW.work_id) THEN
      RAISE EXCEPTION 'This edition belongs to another book' USING ERRCODE = '23514', CONSTRAINT = 'reading_edition_work';
    END IF;
  END IF;
  IF NEW.instance_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.instance_id IS DISTINCT FROM OLD.instance_id OR NEW.edition_id IS DISTINCT FROM OLD.edition_id) THEN
    IF NOT EXISTS (SELECT 1 FROM instances WHERE id = NEW.instance_id AND edition_id = NEW.edition_id) THEN
      RAISE EXCEPTION 'This copy belongs to another edition' USING ERRCODE = '23514', CONSTRAINT = 'reading_instance_edition';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reading_guard BEFORE INSERT OR UPDATE ON readings FOR EACH ROW EXECUTE FUNCTION guard_reading();
--> statement-breakpoint
CREATE FUNCTION guard_reading_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.edition_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.edition_id IS DISTINCT FROM OLD.edition_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM editions e JOIN readings r ON r.work_id = e.work_id
      WHERE e.id = NEW.edition_id AND r.id = NEW.reading_id
    ) THEN
      RAISE EXCEPTION 'This edition belongs to another book' USING ERRCODE = '23514', CONSTRAINT = 'reading_session_edition_work';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reading_session_guard BEFORE INSERT OR UPDATE ON reading_sessions FOR EACH ROW EXECUTE FUNCTION guard_reading_session();

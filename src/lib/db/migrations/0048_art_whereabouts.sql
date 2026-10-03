CREATE TABLE "art_object_whereabouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_id" uuid NOT NULL,
	"place_kind" text NOT NULL,
	"venue_id" uuid,
	"place_label" text,
	"custody" text DEFAULT 'unknown' NOT NULL,
	"display_status" text DEFAULT 'unknown' NOT NULL,
	"certainty" text NOT NULL,
	"starts_on_id" uuid,
	"ends_on_id" uuid,
	"occasion_label" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"notes" text,
	"source_record_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "art_whereabouts_place_check" CHECK ("art_object_whereabouts"."place_kind" in ('venue','private','unknown','lost','destroyed')
        and ("art_object_whereabouts"."place_kind"='venue') = ("art_object_whereabouts"."venue_id" is not null)
        and ("art_object_whereabouts"."place_label" is null or length(trim("art_object_whereabouts"."place_label")) between 1 and 300)
        and ("art_object_whereabouts"."occasion_label" is null or length(trim("art_object_whereabouts"."occasion_label")) between 1 and 300)),
	CONSTRAINT "art_whereabouts_custody_check" CHECK ("art_object_whereabouts"."custody" in ('permanent_collection','temporary_loan','long_term_loan','private','unknown')
        and "art_object_whereabouts"."display_status" in ('on_display','in_storage','unknown')
        and "art_object_whereabouts"."certainty" in ('confirmed','probable','uncertain')
        and ("art_object_whereabouts"."custody" not in ('permanent_collection','temporary_loan','long_term_loan') or "art_object_whereabouts"."place_kind"='venue')
        and ("art_object_whereabouts"."display_status"='unknown' or "art_object_whereabouts"."place_kind"='venue')
        and ("art_object_whereabouts"."place_kind" not in ('lost','destroyed') or "art_object_whereabouts"."custody"='unknown'))
);
--> statement-breakpoint
ALTER TABLE "art_object_whereabouts" ADD CONSTRAINT "art_object_whereabouts_object_id_art_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."art_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_object_whereabouts" ADD CONSTRAINT "art_object_whereabouts_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_object_whereabouts" ADD CONSTRAINT "art_object_whereabouts_starts_on_id_catalogue_dates_id_fk" FOREIGN KEY ("starts_on_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_object_whereabouts" ADD CONSTRAINT "art_object_whereabouts_ends_on_id_catalogue_dates_id_fk" FOREIGN KEY ("ends_on_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_object_whereabouts" ADD CONSTRAINT "art_object_whereabouts_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "art_whereabouts_object_idx" ON "art_object_whereabouts" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "art_whereabouts_venue_idx" ON "art_object_whereabouts" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "art_whereabouts_current_unique" ON "art_object_whereabouts" USING btree ("object_id") WHERE "art_object_whereabouts"."certainty" = 'confirmed' and "art_object_whereabouts"."ends_on_id" is null;--> statement-breakpoint
CREATE FUNCTION guard_art_whereabouts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE work_arg uuid; start_hi bigint; end_lo bigint;
BEGIN
 IF TG_OP='UPDATE' AND NEW.object_id<>OLD.object_id THEN
   RAISE EXCEPTION 'A location record cannot move to another object';
 END IF;
 -- Serializes writes per object, so two competing moves cannot both pass.
 SELECT work_id INTO work_arg FROM art_objects WHERE id=NEW.object_id FOR UPDATE;
 PERFORM work_require_source(NEW.source_record_id,work_arg,'painting');
 PERFORM catalogue_require_date_order(NEW.starts_on_id,NEW.ends_on_id);
 IF NEW.verified_at > clock_timestamp() + interval '5 minutes' THEN
   RAISE EXCEPTION 'A location cannot be verified in the future';
 END IF;
 IF NEW.certainty='confirmed' THEN
   -- Only definite overlaps are rejected: partial dates that merely touch or
   -- share a boundary year stay valid.
   SELECT coalesce((SELECT upper_bound FROM catalogue_dates WHERE id=NEW.starts_on_id),-9223372036854775807),
          coalesce((SELECT lower_bound FROM catalogue_dates WHERE id=NEW.ends_on_id),9223372036854775807)
     INTO start_hi,end_lo;
   IF EXISTS(SELECT 1 FROM art_object_whereabouts w
       LEFT JOIN catalogue_dates s ON s.id=w.starts_on_id LEFT JOIN catalogue_dates e ON e.id=w.ends_on_id
       WHERE w.object_id=NEW.object_id AND w.id<>NEW.id AND w.certainty='confirmed'
         AND coalesce(s.upper_bound,-9223372036854775807) < end_lo
         AND start_hi < coalesce(e.lower_bound,9223372036854775807)) THEN
     RAISE EXCEPTION 'Confirmed locations of one object cannot overlap; close or correct the other record first';
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER art_whereabouts_guard BEFORE INSERT OR UPDATE ON art_object_whereabouts FOR EACH ROW EXECUTE FUNCTION guard_art_whereabouts();
--> statement-breakpoint
-- Venue images no longer block deletion: deleteVenue removes them after commit.
CREATE OR REPLACE FUNCTION guard_venue_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM source_records WHERE venue_id=OLD.id)
 OR EXISTS(SELECT 1 FROM catalogue_identifiers WHERE venue_id=OLD.id) THEN
   RAISE EXCEPTION 'Archive a venue with provenance instead of deleting it';
 END IF;
 IF EXISTS(SELECT 1 FROM art_object_whereabouts WHERE venue_id=OLD.id) THEN
   RAISE EXCEPTION 'Archive a venue that appears in artwork location history instead of deleting it';
 END IF;
 RETURN OLD;
END $$;

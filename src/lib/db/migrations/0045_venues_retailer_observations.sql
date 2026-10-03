ALTER TYPE "public"."venue_type_enum" ADD VALUE 'perfumery';--> statement-breakpoint
ALTER TYPE "public"."venue_type_enum" ADD VALUE 'cinema';--> statement-breakpoint
CREATE TABLE "perfume_retailer_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"variant_id" uuid,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid,
	"url" text NOT NULL,
	"source_record_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perfume_retailer_identity_unique" UNIQUE NULLS NOT DISTINCT("work_id","variant_id","organization_id","venue_id","url"),
	CONSTRAINT "perfume_retailer_url_check" CHECK (length("perfume_retailer_links"."url") between 1 and 4000 and "perfume_retailer_links"."url" ~ '^https?://[^[:space:]@/]+([/:?#][^[:space:]]*)?$')
);
--> statement-breakpoint
CREATE TABLE "perfume_retailer_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"availability" text DEFAULT 'unknown' NOT NULL,
	"price" numeric(11, 2),
	"currency" text,
	"container" text,
	"capacity_ml" numeric(12, 3),
	"package_label" text,
	"source_record_id" uuid,
	"notes" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perfume_retailer_availability_check" CHECK ("perfume_retailer_observations"."availability" in ('unknown','in_stock','out_of_stock','preorder','discontinued','unlisted')),
	CONSTRAINT "perfume_retailer_price_check" CHECK (("perfume_retailer_observations"."price" is null and "perfume_retailer_observations"."currency" is null) or ("perfume_retailer_observations"."price" is not null and "perfume_retailer_observations"."price" between 0 and 999999999.99 and "perfume_retailer_observations"."currency" is not null and "perfume_retailer_observations"."currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "perfume_retailer_container_check" CHECK (("perfume_retailer_observations"."container" is null or "perfume_retailer_observations"."container" in ('bottle','sample','decant')) and ("perfume_retailer_observations"."capacity_ml" is null or ("perfume_retailer_observations"."container" is not null and "perfume_retailer_observations"."capacity_ml">0 and "perfume_retailer_observations"."capacity_ml"<=1000000))),
	CONSTRAINT "perfume_retailer_checked_at_check" CHECK (isfinite("perfume_retailer_observations"."checked_at") and "perfume_retailer_observations"."checked_at" <= "perfume_retailer_observations"."recorded_at" + interval '5 minutes')
);
--> statement-breakpoint
ALTER TABLE "catalogue_identifiers" DROP CONSTRAINT "catalogue_identifiers_venue_id_venues_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_venue_id_venues_id_fk";
--> statement-breakpoint
ALTER TABLE "source_records" DROP CONSTRAINT "source_records_venue_id_venues_id_fk";
--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "search_text" text GENERATED ALWAYS AS (search_normalize(name || ' ' || coalesce(formatted_address, ''))) STORED;--> statement-breakpoint
ALTER TABLE "perfume_retailer_links" ADD CONSTRAINT "perfume_retailer_links_work_id_perfume_details_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."perfume_details"("work_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_retailer_links" ADD CONSTRAINT "perfume_retailer_links_variant_id_perfume_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."perfume_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_retailer_links" ADD CONSTRAINT "perfume_retailer_links_organization_id_publishing_houses_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."publishing_houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_retailer_links" ADD CONSTRAINT "perfume_retailer_links_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_retailer_links" ADD CONSTRAINT "perfume_retailer_links_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_retailer_observations" ADD CONSTRAINT "perfume_retailer_observations_link_id_perfume_retailer_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."perfume_retailer_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_retailer_observations" ADD CONSTRAINT "perfume_retailer_observations_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perfume_retailer_work_idx" ON "perfume_retailer_links" USING btree ("work_id","id");--> statement-breakpoint
CREATE INDEX "perfume_retailer_variant_idx" ON "perfume_retailer_links" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "perfume_retailer_org_idx" ON "perfume_retailer_links" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "perfume_retailer_venue_idx" ON "perfume_retailer_links" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "perfume_retailer_observation_date_idx" ON "perfume_retailer_observations" USING btree ("link_id","checked_at" DESC NULLS LAST,"recorded_at" DESC NULLS LAST,"id");--> statement-breakpoint
ALTER TABLE "catalogue_identifiers" ADD CONSTRAINT "catalogue_identifiers_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venues_search_idx" ON "venues" USING gin ("search_text" gin_trgm_ops);
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM venues WHERE length(trim(name)) NOT BETWEEN 1 AND 500 OR personal_rating NOT BETWEEN 1 AND 5 OR first_visit_date > last_visit_date) THEN
  RAISE EXCEPTION 'Resolve existing venues with a blank name, a rating outside 1-5 or a last visit before the first visit before migration; no venues were changed';
 END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_venue_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF length(trim(NEW.name)) NOT BETWEEN 1 AND 500 OR NEW.personal_rating NOT BETWEEN 1 AND 5 THEN
   RAISE EXCEPTION 'Invalid venue name or rating';
 END IF;
 IF NEW.first_visit_date > NEW.last_visit_date THEN RAISE EXCEPTION 'Last visit cannot precede first visit'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER venue_write_guard BEFORE INSERT OR UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION guard_venue_write();
--> statement-breakpoint
CREATE FUNCTION guard_venue_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ((OLD.poster_s3_key IS NOT NULL OR OLD.thumbnail_s3_key IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM venues v WHERE harmonization_allows_move('venues',OLD.id,v.id)))
 OR EXISTS(SELECT 1 FROM source_records WHERE venue_id=OLD.id)
 OR EXISTS(SELECT 1 FROM catalogue_identifiers WHERE venue_id=OLD.id) THEN
   RAISE EXCEPTION 'Archive a venue with artwork or provenance instead of deleting it';
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER venue_delete_guard BEFORE DELETE ON venues FOR EACH ROW EXECUTE FUNCTION guard_venue_delete();
--> statement-breakpoint
CREATE FUNCTION guard_perfume_retailer_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE variant_work uuid; branch_archived timestamptz;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF (NEW.id,NEW.work_id,NEW.variant_id,NEW.url,NEW.source_record_id,NEW.created_at) IS DISTINCT FROM
      (OLD.id,OLD.work_id,OLD.variant_id,OLD.url,OLD.source_record_id,OLD.created_at) THEN
     RAISE EXCEPTION 'Retailer listing identity is immutable; archive and create a replacement';
   END IF;
   IF NEW.organization_id<>OLD.organization_id AND NOT harmonization_allows_move('publishers',OLD.organization_id,NEW.organization_id) THEN
     RAISE EXCEPTION 'Retailer identity can only move through an audited organization merge';
   END IF;
   IF NEW.venue_id IS DISTINCT FROM OLD.venue_id AND NOT coalesce(harmonization_allows_move('venues',OLD.venue_id,NEW.venue_id),false) THEN
     RAISE EXCEPTION 'Retailer branch identity is immutable; archive and create a replacement';
   END IF;
 END IF;
 IF NEW.variant_id IS NOT NULL THEN
   SELECT work_id INTO variant_work FROM perfume_variants WHERE id=NEW.variant_id FOR SHARE;
   IF variant_work IS DISTINCT FROM NEW.work_id THEN RAISE EXCEPTION 'Retailer formulation belongs to another fragrance'; END IF;
 END IF;
 PERFORM perfume_require_source(NEW.source_record_id,NEW.work_id);
 PERFORM perfume_require_organization_role(NEW.organization_id,'retailer');
 IF NEW.venue_id IS NOT NULL THEN
   PERFORM 1 FROM organization_venues WHERE organization_id=NEW.organization_id AND venue_id=NEW.venue_id AND role='operator' FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Retailer must operate this branch'; END IF;
 END IF;
 IF TG_OP='INSERT' OR NEW.archived_at IS NULL THEN
   SELECT archived_at INTO branch_archived FROM venues WHERE id=NEW.venue_id FOR SHARE;
   IF branch_archived IS NOT NULL THEN
     RAISE EXCEPTION 'Restore the archived branch before adding or restoring a listing';
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER perfume_retailer_link_guard BEFORE INSERT OR UPDATE ON perfume_retailer_links FOR EACH ROW EXECUTE FUNCTION guard_perfume_retailer_link();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_perfume_organization_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM organization_roles WHERE organization_id=OLD.organization_id AND role=OLD.role)
 AND (EXISTS(SELECT 1 FROM perfume_organizations WHERE organization_id=OLD.organization_id AND role=OLD.role)
   OR (OLD.role='retailer' AND (EXISTS(SELECT 1 FROM perfume_bottles WHERE supplier_id=OLD.organization_id)
     OR EXISTS(SELECT 1 FROM perfume_retailer_links WHERE organization_id=OLD.organization_id)))) THEN
   RAISE EXCEPTION 'This organization role is in use by perfume records';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_retailer_branch_unlink() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.role='operator' AND EXISTS(SELECT 1 FROM perfume_retailer_links WHERE organization_id=OLD.organization_id AND venue_id=OLD.venue_id)
 AND NOT EXISTS(SELECT 1 FROM organization_venues WHERE organization_id=OLD.organization_id AND venue_id=OLD.venue_id AND role='operator') THEN
   RAISE EXCEPTION 'Retailer listing history still references this operated branch';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER retailer_branch_unlink_guard AFTER UPDATE OR DELETE ON organization_venues
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_retailer_branch_unlink();
--> statement-breakpoint
CREATE FUNCTION guard_retailer_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE listing perfume_retailer_links; branch_archived timestamptz;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Retailer observations are append-only'; END IF;
 SELECT * INTO listing FROM perfume_retailer_links WHERE id=NEW.link_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Retailer link not found'; END IF;
 IF listing.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore the listing before recording another observation'; END IF;
 IF listing.venue_id IS NOT NULL THEN
   SELECT archived_at INTO branch_archived FROM venues WHERE id=listing.venue_id FOR SHARE;
   IF branch_archived IS NOT NULL THEN RAISE EXCEPTION 'Restore the branch before recording another observation'; END IF;
 END IF;
 PERFORM perfume_require_source(NEW.source_record_id,listing.work_id);
 NEW.recorded_at:=clock_timestamp();
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER perfume_retailer_observation_guard BEFORE INSERT OR UPDATE OR DELETE ON perfume_retailer_observations FOR EACH ROW EXECUTE FUNCTION guard_retailer_observation();

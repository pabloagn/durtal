CREATE TABLE "film_countries" (
	"work_id" uuid NOT NULL,
	"country_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "film_countries_work_id_country_id_pk" PRIMARY KEY("work_id","country_id"),
	CONSTRAINT "film_country_order_check" CHECK ("film_countries"."sort_order">=0)
);
--> statement-breakpoint
CREATE TABLE "film_details" (
	"work_id" uuid PRIMARY KEY NOT NULL,
	"original_title" text,
	"release_date_id" uuid,
	"source_record_id" uuid,
	CONSTRAINT "film_original_title_check" CHECK ("film_details"."original_title" is null or length(trim("film_details"."original_title")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "film_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"version_id" uuid,
	"release_id" uuid,
	"medium" text NOT NULL,
	"format_label" text,
	"status" text DEFAULT 'held' NOT NULL,
	"condition" text,
	"location_id" uuid,
	"sub_location_id" uuid,
	"acquisition_date_id" uuid,
	"supplier_id" uuid,
	"venue_id" uuid,
	"acquisition_price" numeric(11, 2),
	"acquisition_currency" text,
	"disposition_date_id" uuid,
	"disposition_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "film_holding_kind_check" CHECK ("film_holdings"."medium" in ('physical','digital') and "film_holdings"."status" in ('held','lent_out','in_storage','missing','disposed') and ("film_holdings"."format_label" is null or length(trim("film_holdings"."format_label")) between 1 and 200)),
	CONSTRAINT "film_holding_location_check" CHECK ("film_holdings"."sub_location_id" is null or "film_holdings"."location_id" is not null),
	CONSTRAINT "film_holding_price_check" CHECK (("film_holdings"."acquisition_price" is null and "film_holdings"."acquisition_currency" is null) or ("film_holdings"."acquisition_price" is not null and "film_holdings"."acquisition_price">=0 and "film_holdings"."acquisition_price"<=999999999.99 and "film_holdings"."acquisition_currency" is not null and "film_holdings"."acquisition_currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "film_holding_disposition_check" CHECK ("film_holdings"."status"='disposed' or ("film_holdings"."disposition_date_id" is null and "film_holdings"."disposition_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "film_languages" (
	"work_id" uuid NOT NULL,
	"language_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "film_languages_work_id_language_id_pk" PRIMARY KEY("work_id","language_id"),
	CONSTRAINT "film_language_order_check" CHECK ("film_languages"."sort_order">=0)
);
--> statement-breakpoint
CREATE TABLE "film_organizations" (
	"work_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_record_id" uuid,
	CONSTRAINT "film_organizations_work_id_organization_id_role_pk" PRIMARY KEY("work_id","organization_id","role"),
	CONSTRAINT "film_organization_role_check" CHECK ("film_organizations"."role" in ('production_company') and "film_organizations"."sort_order">=0)
);
--> statement-breakpoint
CREATE TABLE "film_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"country_id" uuid,
	"territory_label" text,
	"format" text NOT NULL,
	"release_date_id" uuid,
	"distributor_id" uuid,
	"notes" text,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "film_release_check" CHECK ("film_releases"."format" in ('theatrical','festival','television','home_media','streaming','other') and ("film_releases"."territory_label" is null or length(trim("film_releases"."territory_label")) between 1 and 200))
);
--> statement-breakpoint
CREATE TABLE "film_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"label" text,
	"runtime_seconds" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "film_version_identity_unique" UNIQUE NULLS NOT DISTINCT("work_id","label"),
	CONSTRAINT "film_version_check" CHECK (("film_versions"."label" is null or length(trim("film_versions"."label")) between 1 and 200) and ("film_versions"."runtime_seconds" is null or "film_versions"."runtime_seconds" between 1 and 3600000) and "film_versions"."sort_order">=0)
);
--> statement-breakpoint
ALTER TABLE "film_countries" ADD CONSTRAINT "film_countries_work_id_film_details_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."film_details"("work_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_countries" ADD CONSTRAINT "film_countries_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_details" ADD CONSTRAINT "film_details_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_details" ADD CONSTRAINT "film_details_release_date_id_catalogue_dates_id_fk" FOREIGN KEY ("release_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_details" ADD CONSTRAINT "film_details_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_holdings" ADD CONSTRAINT "film_holdings_work_id_film_details_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."film_details"("work_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_holdings" ADD CONSTRAINT "film_holdings_version_id_film_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."film_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_holdings" ADD CONSTRAINT "film_holdings_release_id_film_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."film_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_holdings" ADD CONSTRAINT "film_holdings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_holdings" ADD CONSTRAINT "film_holdings_sub_location_id_sub_locations_id_fk" FOREIGN KEY ("sub_location_id") REFERENCES "public"."sub_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_holdings" ADD CONSTRAINT "film_holdings_acquisition_date_id_catalogue_dates_id_fk" FOREIGN KEY ("acquisition_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_holdings" ADD CONSTRAINT "film_holdings_supplier_id_publishing_houses_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."publishing_houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_holdings" ADD CONSTRAINT "film_holdings_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_holdings" ADD CONSTRAINT "film_holdings_disposition_date_id_catalogue_dates_id_fk" FOREIGN KEY ("disposition_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_languages" ADD CONSTRAINT "film_languages_work_id_film_details_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."film_details"("work_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_languages" ADD CONSTRAINT "film_languages_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_organizations" ADD CONSTRAINT "film_organizations_work_id_film_details_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."film_details"("work_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_organizations" ADD CONSTRAINT "film_organizations_organization_id_publishing_houses_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."publishing_houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_organizations" ADD CONSTRAINT "film_organizations_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_releases" ADD CONSTRAINT "film_releases_version_id_film_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."film_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_releases" ADD CONSTRAINT "film_releases_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_releases" ADD CONSTRAINT "film_releases_release_date_id_catalogue_dates_id_fk" FOREIGN KEY ("release_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_releases" ADD CONSTRAINT "film_releases_distributor_id_publishing_houses_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."publishing_houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_releases" ADD CONSTRAINT "film_releases_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_versions" ADD CONSTRAINT "film_versions_work_id_film_details_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."film_details"("work_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "film_versions" ADD CONSTRAINT "film_versions_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "film_country_idx" ON "film_countries" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "film_holding_work_idx" ON "film_holdings" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "film_holding_version_idx" ON "film_holdings" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "film_holding_release_idx" ON "film_holdings" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "film_holding_location_idx" ON "film_holdings" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "film_holding_supplier_idx" ON "film_holdings" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "film_holding_venue_idx" ON "film_holdings" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "film_language_idx" ON "film_languages" USING btree ("language_id");--> statement-breakpoint
CREATE INDEX "film_organization_idx" ON "film_organizations" USING btree ("organization_id","role");--> statement-breakpoint
CREATE INDEX "film_release_version_idx" ON "film_releases" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "film_release_country_idx" ON "film_releases" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "film_release_distributor_idx" ON "film_releases" USING btree ("distributor_id");--> statement-breakpoint
CREATE INDEX "film_version_work_idx" ON "film_versions" USING btree ("work_id","sort_order","id");--> statement-breakpoint
CREATE FUNCTION organization_require_role(org_id uuid,role_arg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM organization_roles WHERE organization_id=org_id AND role=role_arg FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Organization does not have the required % role',role_arg; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION film_require_source(source_id uuid,owner_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_records WHERE id=source_id AND entity_kind='film' AND work_id=owner_id) THEN
   RAISE EXCEPTION 'The source must belong to this film';
 END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_film_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE work_arg uuid; kind_arg work_kind_enum;
BEGIN
 IF TG_TABLE_NAME='film_details' THEN
   SELECT kind INTO kind_arg FROM works WHERE id=NEW.work_id;
   IF kind_arg IS DISTINCT FROM 'film' THEN RAISE EXCEPTION 'Film profiles require a film work'; END IF;
 END IF;
 IF TG_TABLE_NAME='film_releases' THEN
   IF TG_OP='UPDATE' AND NEW.version_id<>OLD.version_id THEN
     RAISE EXCEPTION 'A release cannot move to another version';
   END IF;
   SELECT work_id INTO work_arg FROM film_versions WHERE id=NEW.version_id FOR SHARE;
   IF NEW.distributor_id IS NOT NULL THEN PERFORM organization_require_role(NEW.distributor_id,'distribution_company'); END IF;
 ELSE
   IF TG_OP='UPDATE' AND NEW.work_id<>OLD.work_id THEN
     RAISE EXCEPTION 'A film profile, company or version cannot move to another film';
   END IF;
   work_arg:=NEW.work_id;
 END IF;
 IF TG_TABLE_NAME='film_organizations' THEN PERFORM organization_require_role(NEW.organization_id,NEW.role); END IF;
 PERFORM film_require_source(NEW.source_record_id,work_arg);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER film_record_guard BEFORE INSERT OR UPDATE ON film_details FOR EACH ROW EXECUTE FUNCTION guard_film_record();
--> statement-breakpoint
CREATE TRIGGER film_record_guard BEFORE INSERT OR UPDATE ON film_organizations FOR EACH ROW EXECUTE FUNCTION guard_film_record();
--> statement-breakpoint
CREATE TRIGGER film_record_guard BEFORE INSERT OR UPDATE ON film_versions FOR EACH ROW EXECUTE FUNCTION guard_film_record();
--> statement-breakpoint
CREATE TRIGGER film_record_guard BEFORE INSERT OR UPDATE ON film_releases FOR EACH ROW EXECUTE FUNCTION guard_film_record();
--> statement-breakpoint
CREATE FUNCTION guard_film_holding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_work uuid; release_work uuid; release_version uuid; location_type text; sub_parent uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.work_id<>OLD.work_id THEN RAISE EXCEPTION 'A copy cannot move to another film'; END IF;
 IF NEW.version_id IS NOT NULL THEN
   SELECT work_id INTO version_work FROM film_versions WHERE id=NEW.version_id FOR SHARE;
   IF version_work IS DISTINCT FROM NEW.work_id THEN RAISE EXCEPTION 'The version belongs to another film'; END IF;
 END IF;
 IF NEW.release_id IS NOT NULL THEN
   SELECT v.work_id,r.version_id INTO release_work,release_version FROM film_releases r JOIN film_versions v ON v.id=r.version_id WHERE r.id=NEW.release_id FOR SHARE;
   IF release_work IS DISTINCT FROM NEW.work_id THEN RAISE EXCEPTION 'The release belongs to another film'; END IF;
   IF NEW.version_id IS NOT NULL AND release_version<>NEW.version_id THEN RAISE EXCEPTION 'The release belongs to another version'; END IF;
 END IF;
 IF NEW.location_id IS NOT NULL THEN
   SELECT type INTO location_type FROM locations WHERE id=NEW.location_id FOR SHARE;
   IF location_type IS DISTINCT FROM NEW.medium THEN
     RAISE EXCEPTION 'A physical copy needs a physical location and a digital copy a digital one';
   END IF;
 END IF;
 IF NEW.sub_location_id IS NOT NULL THEN
   SELECT location_id INTO sub_parent FROM sub_locations WHERE id=NEW.sub_location_id FOR SHARE;
   IF sub_parent IS DISTINCT FROM NEW.location_id THEN RAISE EXCEPTION 'Sublocation must belong to the selected personal location'; END IF;
 END IF;
 IF NEW.supplier_id IS NOT NULL THEN PERFORM organization_require_role(NEW.supplier_id,'retailer'); END IF;
 PERFORM catalogue_require_date_order(NEW.acquisition_date_id,NEW.disposition_date_id);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER film_holding_guard BEFORE INSERT OR UPDATE ON film_holdings FOR EACH ROW EXECUTE FUNCTION guard_film_holding();
--> statement-breakpoint
CREATE FUNCTION guard_film_personal_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='locations' THEN
   IF EXISTS(SELECT 1 FROM film_holdings WHERE location_id=NEW.id AND medium<>NEW.type) THEN
     RAISE EXCEPTION 'This location holds film copies of the other medium';
   END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM film_holdings WHERE sub_location_id=NEW.id AND location_id<>NEW.location_id) THEN
     RAISE EXCEPTION 'Move film copies before changing the sublocation parent';
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER film_location_guard BEFORE UPDATE OF type ON locations FOR EACH ROW EXECUTE FUNCTION guard_film_personal_location();
--> statement-breakpoint
CREATE TRIGGER film_sublocation_guard BEFORE UPDATE OF location_id ON sub_locations FOR EACH ROW EXECUTE FUNCTION guard_film_personal_location();
--> statement-breakpoint
CREATE FUNCTION validate_film_organization_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM organization_roles WHERE organization_id=OLD.organization_id AND role=OLD.role)
 AND ((OLD.role='production_company' AND EXISTS(SELECT 1 FROM film_organizations WHERE organization_id=OLD.organization_id AND role='production_company'))
   OR (OLD.role='distribution_company' AND EXISTS(SELECT 1 FROM film_releases WHERE distributor_id=OLD.organization_id))
   OR (OLD.role='retailer' AND EXISTS(SELECT 1 FROM film_holdings WHERE supplier_id=OLD.organization_id))) THEN
   RAISE EXCEPTION 'This organization role is in use by film records';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER film_organization_role_guard AFTER UPDATE OR DELETE ON organization_roles
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_film_organization_role();

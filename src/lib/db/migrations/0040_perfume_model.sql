CREATE TABLE "perfume_bottles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"container" text NOT NULL,
	"capacity_value" numeric(15, 6) NOT NULL,
	"volume_unit" text NOT NULL,
	"capacity_ml" numeric(15, 3) GENERATED ALWAYS AS (capacity_value * case volume_unit when 'l' then 1000 else 1 end) STORED,
	"remaining_ml" numeric(15, 3),
	"status" text DEFAULT 'held' NOT NULL,
	"batch_code" text,
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
	CONSTRAINT "perfume_bottle_quantity_check" CHECK ("perfume_bottles"."capacity_value">0 and "perfume_bottles"."capacity_value"<=1000000 and "perfume_bottles"."volume_unit" in ('ml','l') and ("perfume_bottles"."remaining_ml" is null or ("perfume_bottles"."remaining_ml">=0 and "perfume_bottles"."remaining_ml"<="perfume_bottles"."capacity_ml"))),
	CONSTRAINT "perfume_bottle_kind_check" CHECK ("perfume_bottles"."container" in ('bottle','sample','decant') and "perfume_bottles"."status" in ('held','lent_out','in_storage','missing','disposed')),
	CONSTRAINT "perfume_bottle_location_check" CHECK ("perfume_bottles"."sub_location_id" is null or "perfume_bottles"."location_id" is not null),
	CONSTRAINT "perfume_bottle_price_check" CHECK (("perfume_bottles"."acquisition_price" is null and "perfume_bottles"."acquisition_currency" is null) or ("perfume_bottles"."acquisition_price" is not null and "perfume_bottles"."acquisition_price">=0 and "perfume_bottles"."acquisition_price"<=999999999.99 and "perfume_bottles"."acquisition_currency" is not null and "perfume_bottles"."acquisition_currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "perfume_bottle_disposition_check" CHECK ("perfume_bottles"."status"='disposed' or ("perfume_bottles"."disposition_date_id" is null and "perfume_bottles"."disposition_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "perfume_details" (
	"work_id" uuid PRIMARY KEY NOT NULL,
	"release_date_id" uuid,
	"discontinued_date_id" uuid,
	"source_record_id" uuid
);
--> statement-breakpoint
CREATE TABLE "perfume_notes" (
	"work_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position" text DEFAULT 'unspecified' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_record_id" uuid,
	CONSTRAINT "perfume_notes_work_id_item_id_position_pk" PRIMARY KEY("work_id","item_id","position"),
	CONSTRAINT "perfume_note_position_check" CHECK ("perfume_notes"."position" in ('top','heart','base','unspecified') and "perfume_notes"."sort_order">=0)
);
--> statement-breakpoint
CREATE TABLE "perfume_organizations" (
	"work_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_record_id" uuid,
	CONSTRAINT "perfume_organizations_work_id_organization_id_role_pk" PRIMARY KEY("work_id","organization_id","role"),
	CONSTRAINT "perfume_organization_role_check" CHECK ("perfume_organizations"."role" in ('perfume_house','brand','manufacturer') and "perfume_organizations"."sort_order">=0)
);
--> statement-breakpoint
CREATE TABLE "perfume_variant_notes" (
	"variant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position" text DEFAULT 'unspecified' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_record_id" uuid,
	CONSTRAINT "perfume_variant_notes_variant_id_item_id_position_pk" PRIMARY KEY("variant_id","item_id","position"),
	CONSTRAINT "perfume_variant_note_position_check" CHECK ("perfume_variant_notes"."position" in ('top','heart','base','unspecified') and "perfume_variant_notes"."sort_order">=0)
);
--> statement-breakpoint
CREATE TABLE "perfume_variant_overrides" (
	"variant_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	CONSTRAINT "perfume_variant_overrides_variant_id_family_id_pk" PRIMARY KEY("variant_id","family_id")
);
--> statement-breakpoint
CREATE TABLE "perfume_variant_perfumers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"person_id" uuid,
	"credited_as" text,
	"attribution" "attribution_enum" DEFAULT 'unspecified' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"source_record_id" uuid,
	CONSTRAINT "perfume_variant_perfumer_check" CHECK ("perfume_variant_perfumers"."sort_order">=0 and ("perfume_variant_perfumers"."person_id" is not null or coalesce(length(trim("perfume_variant_perfumers"."credited_as")),0)>0 or "perfume_variant_perfumers"."attribution" in ('anonymous','unknown')))
);
--> statement-breakpoint
CREATE TABLE "perfume_variant_taxa" (
	"variant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"source_record_id" uuid,
	CONSTRAINT "perfume_variant_taxa_variant_id_item_id_pk" PRIMARY KEY("variant_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "perfume_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"concentration" text,
	"concentration_label" text,
	"formulation_label" text,
	"perfumers_override" boolean DEFAULT false NOT NULL,
	"release_date_id" uuid,
	"discontinued_date_id" uuid,
	"source_record_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perfume_variant_identity_unique" UNIQUE NULLS NOT DISTINCT("work_id","concentration","concentration_label","formulation_label"),
	CONSTRAINT "perfume_variant_concentration_check" CHECK ("perfume_variants"."concentration" is null or "perfume_variants"."concentration" in ('extrait','parfum','eau_de_parfum','eau_de_toilette','eau_de_cologne','eau_fraiche','oil','other')),
	CONSTRAINT "perfume_variant_label_check" CHECK (("perfume_variants"."concentration_label" is null or length(trim("perfume_variants"."concentration_label")) between 1 and 200) and ("perfume_variants"."formulation_label" is null or length(trim("perfume_variants"."formulation_label")) between 1 and 200) and ("perfume_variants"."concentration" is distinct from 'other' or "perfume_variants"."concentration_label" is not null))
);
--> statement-breakpoint
ALTER TABLE "works" ALTER COLUMN "original_language" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "perfume_bottles" ADD CONSTRAINT "perfume_bottles_variant_id_perfume_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."perfume_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_bottles" ADD CONSTRAINT "perfume_bottles_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_bottles" ADD CONSTRAINT "perfume_bottles_sub_location_id_sub_locations_id_fk" FOREIGN KEY ("sub_location_id") REFERENCES "public"."sub_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_bottles" ADD CONSTRAINT "perfume_bottles_acquisition_date_id_catalogue_dates_id_fk" FOREIGN KEY ("acquisition_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_bottles" ADD CONSTRAINT "perfume_bottles_supplier_id_publishing_houses_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."publishing_houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_bottles" ADD CONSTRAINT "perfume_bottles_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_bottles" ADD CONSTRAINT "perfume_bottles_disposition_date_id_catalogue_dates_id_fk" FOREIGN KEY ("disposition_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_details" ADD CONSTRAINT "perfume_details_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_details" ADD CONSTRAINT "perfume_details_release_date_id_catalogue_dates_id_fk" FOREIGN KEY ("release_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_details" ADD CONSTRAINT "perfume_details_discontinued_date_id_catalogue_dates_id_fk" FOREIGN KEY ("discontinued_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_details" ADD CONSTRAINT "perfume_details_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_notes" ADD CONSTRAINT "perfume_notes_work_id_perfume_details_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."perfume_details"("work_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_notes" ADD CONSTRAINT "perfume_notes_item_id_custom_taxonomy_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."custom_taxonomy_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_notes" ADD CONSTRAINT "perfume_notes_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_organizations" ADD CONSTRAINT "perfume_organizations_work_id_perfume_details_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."perfume_details"("work_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_organizations" ADD CONSTRAINT "perfume_organizations_organization_id_publishing_houses_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."publishing_houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_organizations" ADD CONSTRAINT "perfume_organizations_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variant_notes" ADD CONSTRAINT "perfume_variant_notes_variant_id_perfume_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."perfume_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variant_notes" ADD CONSTRAINT "perfume_variant_notes_item_id_custom_taxonomy_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."custom_taxonomy_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variant_notes" ADD CONSTRAINT "perfume_variant_notes_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variant_overrides" ADD CONSTRAINT "perfume_variant_overrides_variant_id_perfume_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."perfume_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variant_overrides" ADD CONSTRAINT "perfume_variant_overrides_family_id_taxonomy_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."taxonomy_families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variant_perfumers" ADD CONSTRAINT "perfume_variant_perfumers_variant_id_perfume_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."perfume_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variant_perfumers" ADD CONSTRAINT "perfume_variant_perfumers_person_id_authors_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variant_perfumers" ADD CONSTRAINT "perfume_variant_perfumers_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variant_taxa" ADD CONSTRAINT "perfume_variant_taxa_variant_id_perfume_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."perfume_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variant_taxa" ADD CONSTRAINT "perfume_variant_taxa_item_id_custom_taxonomy_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."custom_taxonomy_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variant_taxa" ADD CONSTRAINT "perfume_variant_taxa_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variants" ADD CONSTRAINT "perfume_variants_work_id_perfume_details_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."perfume_details"("work_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variants" ADD CONSTRAINT "perfume_variants_release_date_id_catalogue_dates_id_fk" FOREIGN KEY ("release_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variants" ADD CONSTRAINT "perfume_variants_discontinued_date_id_catalogue_dates_id_fk" FOREIGN KEY ("discontinued_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfume_variants" ADD CONSTRAINT "perfume_variants_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perfume_bottle_variant_idx" ON "perfume_bottles" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "perfume_bottle_location_idx" ON "perfume_bottles" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "perfume_bottle_supplier_idx" ON "perfume_bottles" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "perfume_bottle_venue_idx" ON "perfume_bottles" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "perfume_note_item_idx" ON "perfume_notes" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "perfume_organization_idx" ON "perfume_organizations" USING btree ("organization_id","role");--> statement-breakpoint
CREATE INDEX "perfume_variant_note_item_idx" ON "perfume_variant_notes" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "perfume_override_family_idx" ON "perfume_variant_overrides" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "perfume_variant_perfumer_order_idx" ON "perfume_variant_perfumers" USING btree ("variant_id","sort_order","id");--> statement-breakpoint
CREATE INDEX "perfume_variant_perfumer_person_idx" ON "perfume_variant_perfumers" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "perfume_variant_taxon_idx" ON "perfume_variant_taxa" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "perfume_variant_work_idx" ON "perfume_variants" USING btree ("work_id");--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_language_domain_check" CHECK (("works"."kind"='book' and "works"."original_language" is not null) or ("works"."kind"<>'book' and "works"."original_language" is null));
--> statement-breakpoint
CREATE FUNCTION catalogue_require_date_order(start_id uuid,end_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM catalogue_dates a,catalogue_dates b WHERE a.id=start_id AND b.id=end_id AND a.lower_bound>b.upper_bound) THEN
   RAISE EXCEPTION 'The end date cannot precede the start date';
 END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_catalogue_date_value() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.precision,NEW.start_year,NEW.start_month,NEW.start_day,NEW.end_year,NEW.end_month,NEW.end_day,NEW.approximate,NEW.label)
 IS DISTINCT FROM (OLD.id,OLD.precision,OLD.start_year,OLD.start_month,OLD.start_day,OLD.end_year,OLD.end_month,OLD.end_day,OLD.approximate,OLD.label) THEN
   RAISE EXCEPTION 'Date values are immutable; reference a replacement value';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER catalogue_date_value_guard BEFORE UPDATE ON catalogue_dates FOR EACH ROW EXECUTE FUNCTION guard_catalogue_date_value();
--> statement-breakpoint
CREATE FUNCTION perfume_require_source(source_id uuid,owner_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_records WHERE id=source_id AND entity_kind='perfume' AND work_id=owner_id) THEN
   RAISE EXCEPTION 'The source must belong to this perfume';
 END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_perfume_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE work_arg uuid; kind_arg work_kind_enum;
BEGIN
 IF TG_TABLE_NAME='perfume_details' THEN
   SELECT kind INTO kind_arg FROM works WHERE id=NEW.work_id;
   IF kind_arg IS DISTINCT FROM 'perfume' THEN RAISE EXCEPTION 'Perfume profiles require a perfume work'; END IF;
 END IF;
 IF TG_TABLE_NAME IN ('perfume_details','perfume_variants') THEN
   IF TG_OP='UPDATE' AND NEW.work_id<>OLD.work_id THEN
     RAISE EXCEPTION 'A perfume profile or formulation cannot change work identity';
   END IF;
 END IF;
 IF TG_TABLE_NAME IN ('perfume_details','perfume_variants') THEN
   PERFORM catalogue_require_date_order(NEW.release_date_id,NEW.discontinued_date_id);
 END IF;
 IF TG_TABLE_NAME IN ('perfume_variant_notes','perfume_variant_taxa') THEN
   SELECT work_id INTO work_arg FROM perfume_variants WHERE id=NEW.variant_id;
 ELSE work_arg:=NEW.work_id; END IF;
 PERFORM perfume_require_source(NEW.source_record_id,work_arg);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER perfume_record_guard BEFORE INSERT OR UPDATE ON perfume_details FOR EACH ROW EXECUTE FUNCTION guard_perfume_record();
--> statement-breakpoint
CREATE TRIGGER perfume_record_guard BEFORE INSERT OR UPDATE ON perfume_variants FOR EACH ROW EXECUTE FUNCTION guard_perfume_record();
--> statement-breakpoint
CREATE TRIGGER perfume_record_guard BEFORE INSERT OR UPDATE ON perfume_organizations FOR EACH ROW EXECUTE FUNCTION guard_perfume_record();
--> statement-breakpoint
CREATE TRIGGER perfume_record_guard BEFORE INSERT OR UPDATE ON perfume_notes FOR EACH ROW EXECUTE FUNCTION guard_perfume_record();
--> statement-breakpoint
CREATE TRIGGER perfume_record_guard BEFORE INSERT OR UPDATE ON perfume_variant_notes FOR EACH ROW EXECUTE FUNCTION guard_perfume_record();
--> statement-breakpoint
CREATE TRIGGER perfume_record_guard BEFORE INSERT OR UPDATE ON perfume_variant_taxa FOR EACH ROW EXECUTE FUNCTION guard_perfume_record();
--> statement-breakpoint
CREATE FUNCTION guard_perfume_taxonomy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE family_arg uuid; slug_arg text; level_arg text; has_override boolean;
BEGIN
 IF TG_TABLE_NAME='perfume_variant_overrides' THEN family_arg:=NEW.family_id;
 ELSE SELECT family_id INTO family_arg FROM custom_taxonomy_items WHERE id=NEW.item_id FOR SHARE; END IF;
 SELECT slug INTO slug_arg FROM taxonomy_families WHERE id=family_arg;
 level_arg:=CASE TG_TABLE_NAME WHEN 'perfume_notes' THEN 'work' ELSE 'perfume_variant' END;
 PERFORM taxonomy_require_scope(family_arg,'perfume',level_arg);
 IF TG_TABLE_NAME IN ('perfume_notes','perfume_variant_notes') AND slug_arg IS DISTINCT FROM 'perfume-notes' THEN
   RAISE EXCEPTION 'Positioned notes require the perfume note vocabulary';
 END IF;
 IF TG_TABLE_NAME='perfume_variant_taxa' AND slug_arg='perfume-notes' THEN RAISE EXCEPTION 'Use positioned variant notes'; END IF;
 IF TG_TABLE_NAME IN ('perfume_variant_notes','perfume_variant_taxa') THEN
   PERFORM 1 FROM perfume_variant_overrides WHERE variant_id=NEW.variant_id AND family_id=family_arg FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Declare the variant family override before replacing its inherited values'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER perfume_taxonomy_guard BEFORE INSERT OR UPDATE ON perfume_notes FOR EACH ROW EXECUTE FUNCTION guard_perfume_taxonomy();
--> statement-breakpoint
CREATE TRIGGER perfume_taxonomy_guard BEFORE INSERT OR UPDATE ON perfume_variant_notes FOR EACH ROW EXECUTE FUNCTION guard_perfume_taxonomy();
--> statement-breakpoint
CREATE TRIGGER perfume_taxonomy_guard BEFORE INSERT OR UPDATE ON perfume_variant_taxa FOR EACH ROW EXECUTE FUNCTION guard_perfume_taxonomy();
--> statement-breakpoint
CREATE TRIGGER perfume_taxonomy_guard BEFORE INSERT OR UPDATE ON perfume_variant_overrides FOR EACH ROW EXECUTE FUNCTION guard_perfume_taxonomy();
--> statement-breakpoint
CREATE FUNCTION guard_perfume_override_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Replace a variant override explicitly'; END IF;
 IF EXISTS(SELECT 1 FROM perfume_variants WHERE id=OLD.variant_id) AND (
   EXISTS(SELECT 1 FROM perfume_variant_notes n JOIN custom_taxonomy_items i ON i.id=n.item_id WHERE n.variant_id=OLD.variant_id AND i.family_id=OLD.family_id)
   OR EXISTS(SELECT 1 FROM perfume_variant_taxa n JOIN custom_taxonomy_items i ON i.id=n.item_id WHERE n.variant_id=OLD.variant_id AND i.family_id=OLD.family_id)) THEN
   RAISE EXCEPTION 'Remove variant assignments before restoring inheritance';
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER perfume_override_identity_guard BEFORE UPDATE OR DELETE ON perfume_variant_overrides FOR EACH ROW EXECUTE FUNCTION guard_perfume_override_delete();
--> statement-breakpoint
CREATE FUNCTION guard_perfume_generic_notes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM custom_taxonomy_items i JOIN taxonomy_families f ON f.id=i.family_id WHERE i.id=NEW.item_id AND f.slug='perfume-notes') THEN
   RAISE EXCEPTION 'Use positioned perfume notes instead of generic taxonomy assignment';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER perfume_positioned_notes_guard BEFORE INSERT OR UPDATE ON custom_taxonomy_item_works FOR EACH ROW EXECUTE FUNCTION guard_perfume_generic_notes();
--> statement-breakpoint
CREATE FUNCTION perfume_require_organization_role(org_id uuid,role_arg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM organization_roles WHERE organization_id=org_id AND role=role_arg FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Organization does not have the required % role',role_arg; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_perfume_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM perfume_require_organization_role(NEW.organization_id,NEW.role);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER perfume_organization_guard BEFORE INSERT OR UPDATE ON perfume_organizations FOR EACH ROW EXECUTE FUNCTION guard_perfume_organization();
--> statement-breakpoint
CREATE FUNCTION validate_perfume_organization_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM organization_roles WHERE organization_id=OLD.organization_id AND role=OLD.role)
 AND (EXISTS(SELECT 1 FROM perfume_organizations WHERE organization_id=OLD.organization_id AND role=OLD.role)
   OR (OLD.role='retailer' AND EXISTS(SELECT 1 FROM perfume_bottles WHERE supplier_id=OLD.organization_id))) THEN
   RAISE EXCEPTION 'This organization role is in use by perfume records';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER perfume_organization_role_guard AFTER UPDATE OR DELETE ON organization_roles
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_perfume_organization_role();
--> statement-breakpoint
CREATE FUNCTION guard_perfume_bottle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE location_type text; sub_parent uuid;
BEGIN
 IF NEW.location_id IS NOT NULL THEN
   SELECT type INTO location_type FROM locations WHERE id=NEW.location_id FOR SHARE;
   IF location_type IS DISTINCT FROM 'physical' THEN RAISE EXCEPTION 'Perfume containers require a physical personal location'; END IF;
 END IF;
 IF NEW.sub_location_id IS NOT NULL THEN
   SELECT location_id INTO sub_parent FROM sub_locations WHERE id=NEW.sub_location_id FOR SHARE;
   IF sub_parent IS DISTINCT FROM NEW.location_id THEN RAISE EXCEPTION 'Sublocation must belong to the selected personal location'; END IF;
 END IF;
 IF NEW.supplier_id IS NOT NULL THEN PERFORM perfume_require_organization_role(NEW.supplier_id,'retailer'); END IF;
 PERFORM catalogue_require_date_order(NEW.acquisition_date_id,NEW.disposition_date_id);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER perfume_bottle_guard BEFORE INSERT OR UPDATE ON perfume_bottles FOR EACH ROW EXECUTE FUNCTION guard_perfume_bottle();
--> statement-breakpoint
CREATE FUNCTION guard_perfume_personal_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='locations' THEN
   IF NEW.type<>'physical' AND EXISTS(SELECT 1 FROM perfume_bottles WHERE location_id=NEW.id) THEN RAISE EXCEPTION 'This physical location contains perfume containers'; END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM perfume_bottles WHERE sub_location_id=NEW.id AND location_id<>NEW.location_id) THEN RAISE EXCEPTION 'Move perfume containers before changing the sublocation parent'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER perfume_location_guard BEFORE UPDATE OF type ON locations FOR EACH ROW EXECUTE FUNCTION guard_perfume_personal_location();
--> statement-breakpoint
CREATE TRIGGER perfume_sublocation_guard BEFORE UPDATE OF location_id ON sub_locations FOR EACH ROW EXECUTE FUNCTION guard_perfume_personal_location();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION taxonomy_scope_in_use(family_arg uuid,kind_arg work_kind_enum,level_arg text) RETURNS boolean LANGUAGE sql VOLATILE AS $$ SELECT EXISTS(SELECT 1 FROM work_subjects l JOIN subjects i ON i.id=l.subject_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='subjects' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM edition_genres l JOIN genres i ON i.id=l.genre_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='genres' AND level_arg='edition' AND kind_arg='book') OR EXISTS(SELECT 1 FROM edition_tags l JOIN tags i ON i.id=l.tag_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='tags' AND level_arg='edition' AND kind_arg='book') OR EXISTS(SELECT 1 FROM work_categories l JOIN book_categories i ON i.id=l.category_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='book_categories' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_themes l JOIN themes i ON i.id=l.theme_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='themes' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_literary_movements l JOIN literary_movements i ON i.id=l.literary_movement_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='literary_movements' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_art_types l JOIN art_types i ON i.id=l.art_type_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='art_types' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_art_movements l JOIN art_movements i ON i.id=l.art_movement_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='art_movements' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_keywords l JOIN keywords i ON i.id=l.keyword_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='keywords' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_attributes l JOIN attributes i ON i.id=l.attribute_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='attributes' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM custom_taxonomy_item_works l JOIN custom_taxonomy_items i ON i.id=l.item_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE i.family_id=family_arg AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM custom_taxonomy_item_editions l JOIN custom_taxonomy_items i ON i.id=l.item_id JOIN taxonomy_families f ON f.id=family_arg WHERE i.family_id=family_arg AND level_arg='edition' AND kind_arg='book')  OR (kind_arg='perfume' AND ((level_arg='work' AND EXISTS(SELECT 1 FROM perfume_notes n JOIN custom_taxonomy_items i ON i.id=n.item_id WHERE i.family_id=family_arg)) OR (level_arg='perfume_variant' AND EXISTS(SELECT 1 FROM perfume_variant_overrides WHERE family_id=family_arg)))) $$;

--> statement-breakpoint
CREATE FUNCTION guard_variant_perfumer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE work_arg uuid; override_arg boolean;
BEGIN
 SELECT work_id,perfumers_override INTO work_arg,override_arg FROM perfume_variants WHERE id=NEW.variant_id FOR SHARE;
 IF override_arg IS DISTINCT FROM true THEN RAISE EXCEPTION 'Declare the variant perfumer override before replacing attribution'; END IF;
 PERFORM perfume_require_source(NEW.source_record_id,work_arg);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER variant_perfumer_guard BEFORE INSERT OR UPDATE ON perfume_variant_perfumers FOR EACH ROW EXECUTE FUNCTION guard_variant_perfumer();
--> statement-breakpoint
CREATE FUNCTION register_variant_perfumer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.person_id IS NOT NULL THEN INSERT INTO person_domains(person_id,kind) VALUES(NEW.person_id,'perfume') ON CONFLICT DO NOTHING; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER variant_perfumer_domain AFTER INSERT OR UPDATE ON perfume_variant_perfumers FOR EACH ROW EXECUTE FUNCTION register_variant_perfumer();
--> statement-breakpoint
CREATE FUNCTION guard_variant_perfumer_inheritance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT NEW.perfumers_override AND EXISTS(SELECT 1 FROM perfume_variant_perfumers WHERE variant_id=NEW.id) THEN
   RAISE EXCEPTION 'Remove formulation perfumers before restoring inheritance';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER variant_perfumer_inheritance BEFORE UPDATE OF perfumers_override ON perfume_variants FOR EACH ROW EXECUTE FUNCTION guard_variant_perfumer_inheritance();

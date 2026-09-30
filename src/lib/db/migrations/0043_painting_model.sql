CREATE TABLE "art_object_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_id" uuid NOT NULL,
	"person_id" uuid,
	"credited_as" text,
	"attribution" "attribution_enum" DEFAULT 'unspecified' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"source_record_id" uuid,
	CONSTRAINT "art_object_credit_check" CHECK ("art_object_credits"."sort_order">=0 and ("art_object_credits"."person_id" is not null or coalesce(length(trim("art_object_credits"."credited_as")),0)>0 or "art_object_credits"."attribution" in ('anonymous','unknown')))
);
--> statement-breakpoint
CREATE TABLE "art_object_taxa" (
	"object_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"source_record_id" uuid,
	CONSTRAINT "art_object_taxa_object_id_item_id_pk" PRIMARY KEY("object_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "art_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"reproduces_object_id" uuid,
	"creation_date_id" uuid,
	"height" numeric(10, 3),
	"width" numeric(10, 3),
	"depth" numeric(10, 3),
	"dimension_unit" text,
	"dimensions_note" text,
	"height_cm" numeric(14, 4) GENERATED ALWAYS AS (height * case dimension_unit when 'mm' then 0.1 when 'in' then 2.54 else 1 end) STORED,
	"width_cm" numeric(14, 4) GENERATED ALWAYS AS (width * case dimension_unit when 'mm' then 0.1 when 'in' then 2.54 else 1 end) STORED,
	"attribution_override" boolean DEFAULT false NOT NULL,
	"ownership" text DEFAULT 'unknown' NOT NULL,
	"owner_organization_id" uuid,
	"owner_label" text,
	"collection_name" text,
	"accession_number" text,
	"holding_status" text,
	"location_id" uuid,
	"sub_location_id" uuid,
	"acquisition_date_id" uuid,
	"venue_id" uuid,
	"acquisition_price" numeric(11, 2),
	"acquisition_currency" text,
	"disposition_date_id" uuid,
	"disposition_reason" text,
	"notes" text,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "art_object_kind_check" CHECK ("art_objects"."kind" in ('original','version','reproduction') and ("art_objects"."reproduces_object_id" is null or "art_objects"."kind"='reproduction') and ("art_objects"."label" is null or length(trim("art_objects"."label")) between 1 and 200)),
	CONSTRAINT "art_object_dimension_check" CHECK (("art_objects"."height" is null or "art_objects"."height" between 0.001 and 100000) and ("art_objects"."width" is null or "art_objects"."width" between 0.001 and 100000) and ("art_objects"."depth" is null or "art_objects"."depth" between 0.001 and 100000)
        and ("art_objects"."dimension_unit" is null) = ("art_objects"."height" is null and "art_objects"."width" is null and "art_objects"."depth" is null)
        and ("art_objects"."dimension_unit" is null or "art_objects"."dimension_unit" in ('mm','cm','in'))
        and ("art_objects"."dimensions_note" is null or length(trim("art_objects"."dimensions_note")) between 1 and 500)),
	CONSTRAINT "art_object_ownership_check" CHECK ("art_objects"."ownership" in ('institutional','private','personal','unknown')
        and ("art_objects"."ownership"='institutional') = ("art_objects"."owner_organization_id" is not null)
        and ("art_objects"."owner_label" is null or ("art_objects"."ownership"='private' and length(trim("art_objects"."owner_label")) between 1 and 300))
        and (("art_objects"."collection_name" is null and "art_objects"."accession_number" is null) or "art_objects"."ownership"='institutional')
        and ("art_objects"."collection_name" is null or length(trim("art_objects"."collection_name")) between 1 and 300)
        and ("art_objects"."accession_number" is null or length(trim("art_objects"."accession_number")) between 1 and 200)),
	CONSTRAINT "art_object_holding_check" CHECK (("art_objects"."ownership"='personal') = ("art_objects"."holding_status" is not null)
        and ("art_objects"."holding_status" is null or "art_objects"."holding_status" in ('held','lent_out','in_storage','missing','disposed'))
        and ("art_objects"."ownership"='personal' or ("art_objects"."location_id" is null and "art_objects"."sub_location_id" is null and "art_objects"."acquisition_date_id" is null and "art_objects"."venue_id" is null and "art_objects"."acquisition_price" is null and "art_objects"."disposition_date_id" is null and "art_objects"."disposition_reason" is null))
        and ("art_objects"."sub_location_id" is null or "art_objects"."location_id" is not null)
        and (("art_objects"."acquisition_price" is null and "art_objects"."acquisition_currency" is null) or ("art_objects"."acquisition_price" is not null and "art_objects"."acquisition_price">=0 and "art_objects"."acquisition_price"<=999999999.99 and "art_objects"."acquisition_currency" is not null and "art_objects"."acquisition_currency" ~ '^[A-Z]{3}$'))
        and ("art_objects"."holding_status"='disposed' or ("art_objects"."disposition_date_id" is null and "art_objects"."disposition_reason" is null)))
);
--> statement-breakpoint
CREATE TABLE "painting_details" (
	"work_id" uuid PRIMARY KEY NOT NULL,
	"creation_date_id" uuid,
	"source_record_id" uuid
);
--> statement-breakpoint
ALTER TABLE "art_object_credits" ADD CONSTRAINT "art_object_credits_object_id_art_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."art_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_object_credits" ADD CONSTRAINT "art_object_credits_person_id_authors_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_object_credits" ADD CONSTRAINT "art_object_credits_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_object_taxa" ADD CONSTRAINT "art_object_taxa_object_id_art_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."art_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_object_taxa" ADD CONSTRAINT "art_object_taxa_item_id_custom_taxonomy_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."custom_taxonomy_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_object_taxa" ADD CONSTRAINT "art_object_taxa_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_objects" ADD CONSTRAINT "art_objects_work_id_painting_details_work_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."painting_details"("work_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_objects" ADD CONSTRAINT "art_objects_reproduces_object_id_art_objects_id_fk" FOREIGN KEY ("reproduces_object_id") REFERENCES "public"."art_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_objects" ADD CONSTRAINT "art_objects_creation_date_id_catalogue_dates_id_fk" FOREIGN KEY ("creation_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_objects" ADD CONSTRAINT "art_objects_owner_organization_id_publishing_houses_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."publishing_houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_objects" ADD CONSTRAINT "art_objects_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_objects" ADD CONSTRAINT "art_objects_sub_location_id_sub_locations_id_fk" FOREIGN KEY ("sub_location_id") REFERENCES "public"."sub_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_objects" ADD CONSTRAINT "art_objects_acquisition_date_id_catalogue_dates_id_fk" FOREIGN KEY ("acquisition_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_objects" ADD CONSTRAINT "art_objects_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_objects" ADD CONSTRAINT "art_objects_disposition_date_id_catalogue_dates_id_fk" FOREIGN KEY ("disposition_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_objects" ADD CONSTRAINT "art_objects_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "painting_details" ADD CONSTRAINT "painting_details_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "painting_details" ADD CONSTRAINT "painting_details_creation_date_id_catalogue_dates_id_fk" FOREIGN KEY ("creation_date_id") REFERENCES "public"."catalogue_dates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "painting_details" ADD CONSTRAINT "painting_details_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "art_object_credit_order_idx" ON "art_object_credits" USING btree ("object_id","sort_order","id");--> statement-breakpoint
CREATE INDEX "art_object_credit_person_idx" ON "art_object_credits" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "art_object_taxon_idx" ON "art_object_taxa" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "art_object_work_idx" ON "art_objects" USING btree ("work_id","created_at","id");--> statement-breakpoint
CREATE INDEX "art_object_reproduces_idx" ON "art_objects" USING btree ("reproduces_object_id");--> statement-breakpoint
CREATE INDEX "art_object_owner_idx" ON "art_objects" USING btree ("owner_organization_id");--> statement-breakpoint
CREATE INDEX "art_object_location_idx" ON "art_objects" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "art_object_venue_idx" ON "art_objects" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "art_object_identity_unique" ON "art_objects" USING btree ("work_id",coalesce("label", '')) WHERE "art_objects"."kind" <> 'reproduction';--> statement-breakpoint
CREATE UNIQUE INDEX "art_object_accession_unique" ON "art_objects" USING btree ("owner_organization_id",lower(btrim("accession_number"))) WHERE "art_objects"."accession_number" is not null;

--> statement-breakpoint
CREATE FUNCTION work_require_source(source_id uuid,owner_id uuid,kind_arg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM source_records WHERE id=source_id AND entity_kind=kind_arg AND work_id=owner_id) THEN
   RAISE EXCEPTION 'The source must belong to this %',kind_arg;
 END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_painting_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind_arg work_kind_enum; target record; location_type text; sub_parent uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.work_id<>OLD.work_id THEN
   RAISE EXCEPTION 'A painting profile or object cannot move to another painting';
 END IF;
 IF TG_TABLE_NAME='painting_details' THEN
   SELECT kind INTO kind_arg FROM works WHERE id=NEW.work_id;
   IF kind_arg IS DISTINCT FROM 'painting' THEN RAISE EXCEPTION 'Painting profiles require a painting work'; END IF;
 ELSE
   IF NEW.reproduces_object_id IS NOT NULL THEN
     SELECT work_id,kind INTO target FROM art_objects WHERE id=NEW.reproduces_object_id FOR SHARE;
     IF NEW.reproduces_object_id=NEW.id OR target.work_id IS DISTINCT FROM NEW.work_id OR target.kind='reproduction' THEN
       RAISE EXCEPTION 'A reproduction reproduces an original or version of the same painting';
     END IF;
   END IF;
   IF TG_OP='UPDATE' AND NEW.kind<>OLD.kind AND OLD.kind<>'reproduction' AND EXISTS(SELECT 1 FROM art_objects WHERE reproduces_object_id=NEW.id) THEN
     RAISE EXCEPTION 'Reproductions refer to this object; it must stay an original or version';
   END IF;
   IF NEW.location_id IS NOT NULL THEN
     SELECT type INTO location_type FROM locations WHERE id=NEW.location_id FOR SHARE;
     IF location_type IS DISTINCT FROM 'physical' THEN RAISE EXCEPTION 'Artworks require a physical personal location'; END IF;
   END IF;
   IF NEW.sub_location_id IS NOT NULL THEN
     SELECT location_id INTO sub_parent FROM sub_locations WHERE id=NEW.sub_location_id FOR SHARE;
     IF sub_parent IS DISTINCT FROM NEW.location_id THEN RAISE EXCEPTION 'Sublocation must belong to the selected personal location'; END IF;
   END IF;
   PERFORM catalogue_require_date_order(NEW.acquisition_date_id,NEW.disposition_date_id);
   IF NOT NEW.attribution_override AND EXISTS(SELECT 1 FROM art_object_credits WHERE object_id=NEW.id) THEN
     RAISE EXCEPTION 'Remove object attribution before restoring the painting''s painters';
   END IF;
 END IF;
 PERFORM work_require_source(NEW.source_record_id,NEW.work_id,'painting');
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER painting_record_guard BEFORE INSERT OR UPDATE ON painting_details FOR EACH ROW EXECUTE FUNCTION guard_painting_record();
--> statement-breakpoint
CREATE TRIGGER painting_record_guard BEFORE INSERT OR UPDATE ON art_objects FOR EACH ROW EXECUTE FUNCTION guard_painting_record();
--> statement-breakpoint
CREATE FUNCTION guard_art_object_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE work_arg uuid; override_arg boolean; family_arg uuid;
BEGIN
 SELECT work_id,attribution_override INTO work_arg,override_arg FROM art_objects WHERE id=NEW.object_id FOR SHARE;
 IF TG_TABLE_NAME='art_object_credits' THEN
   IF override_arg IS DISTINCT FROM true THEN RAISE EXCEPTION 'Declare the object attribution override before replacing the painting''s painters'; END IF;
 ELSE
   SELECT family_id INTO family_arg FROM custom_taxonomy_items WHERE id=NEW.item_id FOR SHARE;
   PERFORM taxonomy_require_scope(family_arg,'painting','art_object');
 END IF;
 PERFORM work_require_source(NEW.source_record_id,work_arg,'painting');
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER art_object_child_guard BEFORE INSERT OR UPDATE ON art_object_credits FOR EACH ROW EXECUTE FUNCTION guard_art_object_child();
--> statement-breakpoint
CREATE TRIGGER art_object_child_guard BEFORE INSERT OR UPDATE ON art_object_taxa FOR EACH ROW EXECUTE FUNCTION guard_art_object_child();
--> statement-breakpoint
CREATE FUNCTION register_art_object_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.person_id IS NOT NULL THEN INSERT INTO person_domains(person_id,kind) VALUES(NEW.person_id,'painting') ON CONFLICT DO NOTHING; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER art_object_credit_domain AFTER INSERT OR UPDATE ON art_object_credits FOR EACH ROW EXECUTE FUNCTION register_art_object_credit();
--> statement-breakpoint
CREATE FUNCTION guard_art_personal_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='locations' THEN
   IF NEW.type<>'physical' AND EXISTS(SELECT 1 FROM art_objects WHERE location_id=NEW.id) THEN RAISE EXCEPTION 'This physical location holds artworks'; END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM art_objects WHERE sub_location_id=NEW.id AND location_id<>NEW.location_id) THEN RAISE EXCEPTION 'Move artworks before changing the sublocation parent'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER art_location_guard BEFORE UPDATE OF type ON locations FOR EACH ROW EXECUTE FUNCTION guard_art_personal_location();
--> statement-breakpoint
CREATE TRIGGER art_sublocation_guard BEFORE UPDATE OF location_id ON sub_locations FOR EACH ROW EXECUTE FUNCTION guard_art_personal_location();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION taxonomy_scope_in_use(family_arg uuid,kind_arg work_kind_enum,level_arg text) RETURNS boolean LANGUAGE sql VOLATILE AS $$ SELECT EXISTS(SELECT 1 FROM work_subjects l JOIN subjects i ON i.id=l.subject_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='subjects' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM edition_genres l JOIN genres i ON i.id=l.genre_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='genres' AND level_arg='edition' AND kind_arg='book') OR EXISTS(SELECT 1 FROM edition_tags l JOIN tags i ON i.id=l.tag_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='tags' AND level_arg='edition' AND kind_arg='book') OR EXISTS(SELECT 1 FROM work_categories l JOIN book_categories i ON i.id=l.category_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='book_categories' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_themes l JOIN themes i ON i.id=l.theme_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='themes' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_literary_movements l JOIN literary_movements i ON i.id=l.literary_movement_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='literary_movements' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_art_types l JOIN art_types i ON i.id=l.art_type_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='art_types' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_art_movements l JOIN art_movements i ON i.id=l.art_movement_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='art_movements' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_keywords l JOIN keywords i ON i.id=l.keyword_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='keywords' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_attributes l JOIN attributes i ON i.id=l.attribute_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='attributes' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM custom_taxonomy_item_works l JOIN custom_taxonomy_items i ON i.id=l.item_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE i.family_id=family_arg AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM custom_taxonomy_item_editions l JOIN custom_taxonomy_items i ON i.id=l.item_id JOIN taxonomy_families f ON f.id=family_arg WHERE i.family_id=family_arg AND level_arg='edition' AND kind_arg='book')  OR (kind_arg='perfume' AND ((level_arg='work' AND EXISTS(SELECT 1 FROM perfume_notes n JOIN custom_taxonomy_items i ON i.id=n.item_id WHERE i.family_id=family_arg)) OR (level_arg='perfume_variant' AND EXISTS(SELECT 1 FROM perfume_variant_overrides WHERE family_id=family_arg)))) OR (kind_arg='painting' AND level_arg='art_object' AND EXISTS(SELECT 1 FROM art_object_taxa t JOIN custom_taxonomy_items i ON i.id=t.item_id WHERE i.family_id=family_arg)) $$;

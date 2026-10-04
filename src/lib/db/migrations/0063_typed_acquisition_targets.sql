DROP INDEX "acquisition_targets_active_unique";--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD COLUMN "perfume_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD COLUMN "perfume_container" text;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD COLUMN "perfume_capacity_value" numeric(15, 6);--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD COLUMN "perfume_volume_unit" text;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD COLUMN "film_version_id" uuid;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD COLUMN "film_release_id" uuid;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD COLUMN "film_medium" text;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD COLUMN "film_format_label" text;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD COLUMN "art_object_id" uuid;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD COLUMN "art_reproduces_object_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "film_holding_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "perfume_bottle_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "art_object_id" uuid;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD CONSTRAINT "acquisition_targets_perfume_variant_id_perfume_variants_id_fk" FOREIGN KEY ("perfume_variant_id") REFERENCES "public"."perfume_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD CONSTRAINT "acquisition_targets_film_version_id_film_versions_id_fk" FOREIGN KEY ("film_version_id") REFERENCES "public"."film_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD CONSTRAINT "acquisition_targets_film_release_id_film_releases_id_fk" FOREIGN KEY ("film_release_id") REFERENCES "public"."film_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD CONSTRAINT "acquisition_targets_art_object_id_art_objects_id_fk" FOREIGN KEY ("art_object_id") REFERENCES "public"."art_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD CONSTRAINT "acquisition_targets_art_reproduces_object_id_art_objects_id_fk" FOREIGN KEY ("art_reproduces_object_id") REFERENCES "public"."art_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_film_holding_id_film_holdings_id_fk" FOREIGN KEY ("film_holding_id") REFERENCES "public"."film_holdings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_perfume_bottle_id_perfume_bottles_id_fk" FOREIGN KEY ("perfume_bottle_id") REFERENCES "public"."perfume_bottles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_art_object_id_art_objects_id_fk" FOREIGN KEY ("art_object_id") REFERENCES "public"."art_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acquisition_targets_perfume_variant_idx" ON "acquisition_targets" USING btree ("perfume_variant_id");--> statement-breakpoint
CREATE INDEX "acquisition_targets_film_version_idx" ON "acquisition_targets" USING btree ("film_version_id");--> statement-breakpoint
CREATE INDEX "acquisition_targets_film_release_idx" ON "acquisition_targets" USING btree ("film_release_id");--> statement-breakpoint
CREATE INDEX "acquisition_targets_art_object_idx" ON "acquisition_targets" USING btree ("art_object_id");--> statement-breakpoint
CREATE INDEX "acquisition_targets_art_reproduces_idx" ON "acquisition_targets" USING btree ("art_reproduces_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_film_holding_unique" ON "orders" USING btree ("film_holding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_perfume_bottle_unique" ON "orders" USING btree ("perfume_bottle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_art_object_unique" ON "orders" USING btree ("art_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "acquisition_targets_active_unique" ON "acquisition_targets" USING btree ("work_id",coalesce("edition_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("publisher_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("perfume_variant_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("perfume_container", ''),coalesce("perfume_capacity_value" * case "perfume_volume_unit" when 'l' then 1000 else 1 end, 0),coalesce("film_version_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("film_release_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("film_medium", ''),coalesce("art_object_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("art_reproduces_object_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE NOT "acquisition_targets"."is_cancelled";--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD CONSTRAINT "acquisition_target_typed_check" CHECK (num_nonnulls(coalesce("acquisition_targets"."edition_id", "acquisition_targets"."publisher_id"), "acquisition_targets"."perfume_variant_id", "acquisition_targets"."film_version_id", coalesce("acquisition_targets"."art_object_id", "acquisition_targets"."art_reproduces_object_id")) <= 1
        and ("acquisition_targets"."perfume_variant_id" is null) = ("acquisition_targets"."perfume_container" is null)
        and ("acquisition_targets"."perfume_variant_id" is null) = ("acquisition_targets"."perfume_capacity_value" is null)
        and ("acquisition_targets"."perfume_variant_id" is null) = ("acquisition_targets"."perfume_volume_unit" is null)
        and ("acquisition_targets"."perfume_capacity_value" is null or ("acquisition_targets"."perfume_capacity_value" > 0 and "acquisition_targets"."perfume_capacity_value" <= 1000000))
        and ("acquisition_targets"."perfume_container" is null or "acquisition_targets"."perfume_container" in ('bottle','sample','decant'))
        and ("acquisition_targets"."perfume_volume_unit" is null or "acquisition_targets"."perfume_volume_unit" in ('ml','l'))
        and ("acquisition_targets"."film_version_id" is null) = ("acquisition_targets"."film_medium" is null)
        and ("acquisition_targets"."film_version_id" is not null or ("acquisition_targets"."film_release_id" is null and "acquisition_targets"."film_format_label" is null))
        and ("acquisition_targets"."film_medium" is null or "acquisition_targets"."film_medium" in ('physical','digital'))
        and ("acquisition_targets"."film_format_label" is null or length(trim("acquisition_targets"."film_format_label")) between 1 and 200)
        and ("acquisition_targets"."art_object_id" is null or "acquisition_targets"."art_reproduces_object_id" is null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_received_item_check" CHECK (num_nonnulls("orders"."instance_id", "orders"."film_holding_id", "orders"."perfume_bottle_id", "orders"."art_object_id") <= 1);--> statement-breakpoint
-- SLN-374, custom part (drizzle-kit does not model triggers): a film, perfume
-- or painting may have acquisition targets and orders, but only typed ones.
-- An untyped target or order still needs a book, with the 0038 message and
-- constraint name. validate_target_order is its 0032 definition with a typed
-- branch added; the book branch is unchanged.
CREATE FUNCTION require_target_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k work_kind_enum;
BEGIN
 SELECT kind INTO k FROM works WHERE id = NEW.work_id;
 IF k IS NULL OR (k <> 'book' AND num_nonnulls(NEW.perfume_variant_id, NEW.film_version_id, NEW.art_object_id, NEW.art_reproduces_object_id) = 0) THEN
   RAISE EXCEPTION '% requires an existing book', TG_TABLE_NAME
     USING ERRCODE = '23514', CONSTRAINT = 'book_parent_required';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION require_order_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k work_kind_enum;
BEGIN
 SELECT kind INTO k FROM works WHERE id = NEW.work_id;
 IF k IS NULL OR (k <> 'book' AND NOT EXISTS (
   SELECT 1 FROM acquisition_targets t WHERE t.id = NEW.acquisition_target_id AND t.work_id = NEW.work_id
   AND num_nonnulls(t.perfume_variant_id, t.film_version_id, t.art_object_id, t.art_reproduces_object_id) > 0
 )) THEN
   RAISE EXCEPTION '% requires an existing book', TG_TABLE_NAME
     USING ERRCODE = '23514', CONSTRAINT = 'book_parent_required';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER book_parent_required ON acquisition_targets;
--> statement-breakpoint
CREATE TRIGGER book_parent_required BEFORE INSERT OR UPDATE OF work_id, perfume_variant_id, film_version_id, art_object_id, art_reproduces_object_id ON acquisition_targets FOR EACH ROW EXECUTE FUNCTION require_target_parent();
--> statement-breakpoint
DROP TRIGGER book_parent_required ON orders;
--> statement-breakpoint
CREATE TRIGGER book_parent_required BEFORE INSERT OR UPDATE OF work_id, acquisition_target_id ON orders FOR EACH ROW EXECUTE FUNCTION require_order_parent();
--> statement-breakpoint
-- A typed target names something of its own work, and keeps it. The object a
-- painting target buys is in private or unknown hands: a museum's object has
-- custody records, not a purchase. A harmonization merge may move the target
-- before the formulation, version or object it names.
CREATE FUNCTION validate_typed_acquisition_target() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k work_kind_enum; owner_work uuid; release_version uuid; obj art_objects; merging boolean;
BEGIN
 merging := TG_OP = 'UPDATE' AND NEW.work_id <> OLD.work_id AND harmonization_allows_move('works', OLD.work_id, NEW.work_id);
 IF TG_OP = 'UPDATE' AND (NEW.perfume_variant_id, NEW.perfume_container, NEW.perfume_capacity_value, NEW.perfume_volume_unit,
     NEW.film_version_id, NEW.film_release_id, NEW.film_medium, NEW.film_format_label, NEW.art_object_id, NEW.art_reproduces_object_id)
   IS DISTINCT FROM (OLD.perfume_variant_id, OLD.perfume_container, OLD.perfume_capacity_value, OLD.perfume_volume_unit,
     OLD.film_version_id, OLD.film_release_id, OLD.film_medium, OLD.film_format_label, OLD.art_object_id, OLD.art_reproduces_object_id) THEN
   RAISE EXCEPTION 'Create a new target instead of changing its identity';
 END IF;
 SELECT kind INTO k FROM works WHERE id = NEW.work_id;
 IF k = 'book' THEN
   IF num_nonnulls(NEW.perfume_variant_id, NEW.film_version_id, NEW.art_object_id, NEW.art_reproduces_object_id) > 0 THEN
     RAISE EXCEPTION 'A book target names an edition or a publisher';
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.edition_id IS NOT NULL OR NEW.publisher_id IS NOT NULL THEN
   RAISE EXCEPTION 'Only a book target names an edition or a publisher';
 END IF;
 IF k = 'perfume' THEN
   IF NEW.perfume_variant_id IS NULL THEN RAISE EXCEPTION 'A perfume target names a formulation and a container size'; END IF;
   SELECT work_id INTO owner_work FROM perfume_variants WHERE id = NEW.perfume_variant_id FOR SHARE;
   IF owner_work IS DISTINCT FROM NEW.work_id AND NOT (merging AND owner_work = OLD.work_id) THEN
     RAISE EXCEPTION 'The formulation belongs to another perfume';
   END IF;
 ELSIF k = 'film' THEN
   IF NEW.film_version_id IS NULL THEN RAISE EXCEPTION 'A film target names a version and a medium'; END IF;
   SELECT work_id INTO owner_work FROM film_versions WHERE id = NEW.film_version_id FOR SHARE;
   IF owner_work IS DISTINCT FROM NEW.work_id AND NOT (merging AND owner_work = OLD.work_id) THEN
     RAISE EXCEPTION 'The version belongs to another film';
   END IF;
   IF NEW.film_release_id IS NOT NULL THEN
     SELECT version_id INTO release_version FROM film_releases WHERE id = NEW.film_release_id FOR SHARE;
     IF release_version IS DISTINCT FROM NEW.film_version_id THEN RAISE EXCEPTION 'The release belongs to another version'; END IF;
   END IF;
 ELSIF k = 'painting' THEN
   IF num_nonnulls(NEW.art_object_id, NEW.art_reproduces_object_id) = 0 THEN
     RAISE EXCEPTION 'A painting target names an object to buy, or an object to buy a reproduction of';
   END IF;
   SELECT * INTO obj FROM art_objects WHERE id = coalesce(NEW.art_object_id, NEW.art_reproduces_object_id) FOR SHARE;
   IF obj.work_id IS DISTINCT FROM NEW.work_id AND NOT (merging AND obj.work_id = OLD.work_id) THEN
     RAISE EXCEPTION 'The object belongs to another painting';
   END IF;
   IF TG_OP = 'INSERT' AND NEW.art_object_id IS NOT NULL AND obj.ownership = 'institutional' THEN
     RAISE EXCEPTION 'This object belongs to an institution: its custody is recorded, not bought';
   END IF;
   IF TG_OP = 'INSERT' AND NEW.art_object_id IS NOT NULL AND obj.ownership = 'personal' THEN
     RAISE EXCEPTION 'You already own this object';
   END IF;
   IF NEW.art_reproduces_object_id IS NOT NULL AND obj.kind = 'reproduction' THEN
     RAISE EXCEPTION 'A reproduction reproduces an original or a version';
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER typed_target_guard BEFORE INSERT OR UPDATE ON acquisition_targets FOR EACH ROW EXECUTE FUNCTION validate_typed_acquisition_target();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_target_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t acquisition_targets; audited_move boolean := false; links int; bottle_variant uuid; held film_holdings; obj art_objects;
BEGIN
 links := num_nonnulls(NEW.film_holding_id, NEW.perfume_bottle_id, NEW.art_object_id);
 IF NEW.acquisition_target_id IS NULL THEN
   IF links > 0 THEN RAISE EXCEPTION 'A received film, perfume or painting comes from an order with a target'; END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO t FROM acquisition_targets WHERE id = NEW.acquisition_target_id FOR UPDATE;
 IF NOT FOUND OR t.work_id <> NEW.work_id THEN RAISE EXCEPTION 'Choose a target for this book'; END IF;
 IF TG_OP = 'UPDATE' AND NEW.acquisition_target_id = OLD.acquisition_target_id AND NEW.status = OLD.status AND NEW.status IN ('cancelled', 'returned') THEN
  audited_move := harmonization_allows_move('works', OLD.work_id, NEW.work_id)
    OR harmonization_allows_move('venues', OLD.venue_id, NEW.venue_id)
    OR harmonization_allows_move('places', OLD.origin_place_id, NEW.origin_place_id)
    OR harmonization_allows_move('locations', OLD.destination_location_id, NEW.destination_location_id)
    OR harmonization_allows_move('sub-locations', OLD.destination_sub_location_id, NEW.destination_sub_location_id);
 END IF;
 IF t.is_cancelled AND NOT audited_move THEN RAISE EXCEPTION 'This acquisition target was removed'; END IF;
 IF num_nonnulls(t.perfume_variant_id, t.film_version_id, t.art_object_id, t.art_reproduces_object_id) = 0 THEN
   IF links > 0 THEN RAISE EXCEPTION 'A book order receives a book copy'; END IF;
   IF NEW.edition_id IS NOT NULL AND NOT target_accepts_edition(t.id, NEW.edition_id) THEN
     RAISE EXCEPTION 'This edition does not match the acquisition target';
   END IF;
   IF NEW.status IN ('delivered', 'received', 'purchased') AND NEW.edition_id IS NULL THEN
     RAISE EXCEPTION 'Select the received edition before completing this target';
   END IF;
   IF NEW.instance_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM instances WHERE id = NEW.instance_id AND edition_id = NEW.edition_id) THEN
     RAISE EXCEPTION 'The received copy does not match the ordered edition';
   END IF;
   RETURN NEW;
 END IF;
 -- A film, perfume or painting order: what it brought in, once received
 IF NEW.edition_id IS NOT NULL OR NEW.instance_id IS NOT NULL THEN
   RAISE EXCEPTION 'A film, perfume or painting order has no edition or book copy';
 END IF;
 IF NEW.status IN ('delivered', 'received', 'purchased') AND links = 0 THEN
   IF TG_OP = 'UPDATE' AND num_nonnulls(OLD.film_holding_id, OLD.perfume_bottle_id, OLD.art_object_id) > 0 THEN
     RAISE EXCEPTION 'This came from a received order: return the order before deleting it';
   END IF;
   RAISE EXCEPTION 'A received order records what it brought in';
 END IF;
 IF links > 0 AND NEW.status NOT IN ('delivered', 'received', 'purchased', 'returned') THEN
   RAISE EXCEPTION 'Only a received order records what it brought in';
 END IF;
 IF links > 0 AND (TG_OP = 'INSERT' OR (NEW.film_holding_id, NEW.perfume_bottle_id, NEW.art_object_id) IS DISTINCT FROM (OLD.film_holding_id, OLD.perfume_bottle_id, OLD.art_object_id)) THEN
   IF t.perfume_variant_id IS NOT NULL THEN
     SELECT variant_id INTO bottle_variant FROM perfume_bottles WHERE id = NEW.perfume_bottle_id FOR SHARE;
     IF NEW.perfume_bottle_id IS NULL OR bottle_variant IS DISTINCT FROM t.perfume_variant_id THEN
       RAISE EXCEPTION 'The received container is another formulation than the target';
     END IF;
   ELSIF t.film_version_id IS NOT NULL THEN
     SELECT * INTO held FROM film_holdings WHERE id = NEW.film_holding_id FOR SHARE;
     IF NEW.film_holding_id IS NULL OR held.version_id IS DISTINCT FROM t.film_version_id OR held.medium <> t.film_medium
        OR (t.film_release_id IS NOT NULL AND held.release_id IS DISTINCT FROM t.film_release_id) THEN
       RAISE EXCEPTION 'The received copy is another version, release or medium than the target';
     END IF;
   ELSE
     SELECT * INTO obj FROM art_objects WHERE id = NEW.art_object_id FOR SHARE;
     IF NEW.art_object_id IS NULL OR obj.ownership <> 'personal'
        OR (t.art_object_id IS NOT NULL AND obj.id <> t.art_object_id)
        OR (t.art_reproduces_object_id IS NOT NULL AND (obj.kind <> 'reproduction' OR obj.reproduces_object_id IS DISTINCT FROM t.art_reproduces_object_id)) THEN
       RAISE EXCEPTION 'The received object is not the one the target names';
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;

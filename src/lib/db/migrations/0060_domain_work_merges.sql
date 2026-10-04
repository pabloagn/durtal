-- SLN-373: an audited harmonization merge of two works of one kind may move
-- their films' profiles, companies, versions and copies, their perfumes'
-- formulations and retailer listings, their paintings' objects, and the
-- source records and identifiers of all three to the kept work. Every other
-- change of work_id or source owner is still refused, with the same
-- messages. Each function is its latest definition (0042, 0044, 0045, 0046,
-- 0047) with only the move checks changed.
CREATE OR REPLACE FUNCTION guard_catalogue_source_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_owner uuid; new_owner uuid; merge_entity text; actual_kind text;
BEGIN
 new_owner:=coalesce(NEW.work_id,NEW.edition_id,NEW.person_id,NEW.organization_id,NEW.venue_id);
 IF NEW.work_id IS NOT NULL THEN
   SELECT kind::text INTO actual_kind FROM works WHERE id=NEW.work_id FOR KEY SHARE;
   IF actual_kind IS DISTINCT FROM NEW.entity_kind THEN RAISE EXCEPTION 'Source entity kind must match its work'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
   old_owner:=coalesce(OLD.work_id,OLD.edition_id,OLD.person_id,OLD.organization_id,OLD.venue_id);
   IF NEW.entity_kind IS DISTINCT FROM OLD.entity_kind THEN RAISE EXCEPTION 'Source entity kind is immutable'; END IF;
   IF old_owner IS DISTINCT FROM new_owner THEN
     merge_entity:=CASE OLD.entity_kind WHEN 'book' THEN 'works' WHEN 'film' THEN 'works' WHEN 'perfume' THEN 'works' WHEN 'painting' THEN 'works' WHEN 'person' THEN 'authors' WHEN 'organization' THEN 'publishers' WHEN 'venue' THEN 'venues' ELSE NULL END;
     IF merge_entity IS NULL OR NOT harmonization_allows_move(merge_entity,old_owner,new_owner) THEN
       RAISE EXCEPTION 'Source ownership can only move through an audited merge';
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_film_record() RETURNS trigger LANGUAGE plpgsql AS $$
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
   IF TG_OP='UPDATE' AND NEW.work_id<>OLD.work_id AND NOT harmonization_allows_move('works',OLD.work_id,NEW.work_id) THEN
     RAISE EXCEPTION 'A film profile, company or version cannot move to another film';
   END IF;
   work_arg:=NEW.work_id;
 END IF;
 IF TG_TABLE_NAME='film_organizations' THEN PERFORM organization_require_role(NEW.organization_id,NEW.role); END IF;
 PERFORM film_require_source(NEW.source_record_id,work_arg);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_film_holding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_work uuid; release_work uuid; release_version uuid; location_type text; sub_parent uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.work_id<>OLD.work_id AND NOT harmonization_allows_move('works',OLD.work_id,NEW.work_id) THEN
   RAISE EXCEPTION 'A copy cannot move to another film';
 END IF;
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
CREATE OR REPLACE FUNCTION guard_perfume_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE work_arg uuid; kind_arg work_kind_enum;
BEGIN
 IF TG_TABLE_NAME='perfume_details' THEN
   SELECT kind INTO kind_arg FROM works WHERE id=NEW.work_id;
   IF kind_arg IS DISTINCT FROM 'perfume' THEN RAISE EXCEPTION 'Perfume profiles require a perfume work'; END IF;
 END IF;
 IF TG_TABLE_NAME IN ('perfume_details','perfume_variants') THEN
   IF TG_OP='UPDATE' AND NEW.work_id<>OLD.work_id AND NOT harmonization_allows_move('works',OLD.work_id,NEW.work_id) THEN
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
CREATE OR REPLACE FUNCTION guard_perfume_retailer_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE variant_work uuid; branch_archived timestamptz;
BEGIN
 IF TG_OP='UPDATE' THEN
   -- The fragrance a listing names moves only with an audited merge of the fragrance
   IF (NEW.id,NEW.variant_id,NEW.url,NEW.source_record_id,NEW.created_at) IS DISTINCT FROM
      (OLD.id,OLD.variant_id,OLD.url,OLD.source_record_id,OLD.created_at)
      OR (NEW.work_id<>OLD.work_id AND NOT harmonization_allows_move('works',OLD.work_id,NEW.work_id)) THEN
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
CREATE OR REPLACE FUNCTION guard_painting_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind_arg work_kind_enum; target record; location_type text; sub_parent uuid; merging boolean;
BEGIN
 merging := TG_OP='UPDATE' AND NEW.work_id<>OLD.work_id AND harmonization_allows_move('works',OLD.work_id,NEW.work_id);
 IF TG_OP='UPDATE' AND NEW.work_id<>OLD.work_id AND NOT merging THEN
   RAISE EXCEPTION 'A painting profile or object cannot move to another painting';
 END IF;
 IF TG_TABLE_NAME='painting_details' THEN
   SELECT kind INTO kind_arg FROM works WHERE id=NEW.work_id;
   IF kind_arg IS DISTINCT FROM 'painting' THEN RAISE EXCEPTION 'Painting profiles require a painting work'; END IF;
 ELSE
   IF NEW.reproduces_object_id IS NOT NULL THEN
     SELECT work_id,kind INTO target FROM art_objects WHERE id=NEW.reproduces_object_id FOR SHARE;
     -- In a merge the reproduced object moves in the same statement, before or after this row
     IF NEW.reproduces_object_id=NEW.id OR target.kind='reproduction'
        OR (target.work_id IS DISTINCT FROM NEW.work_id AND NOT (merging AND target.work_id=OLD.work_id)) THEN
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

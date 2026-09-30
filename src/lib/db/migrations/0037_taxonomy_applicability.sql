CREATE TABLE "taxonomy_applicability" (
	"family_id" uuid NOT NULL,
	"kind" "work_kind_enum" NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "taxonomy_applicability_family_id_kind_level_pk" PRIMARY KEY("family_id","kind","level"),
	CONSTRAINT "taxonomy_scope_check" CHECK ("taxonomy_applicability"."level" = 'work' or ("taxonomy_applicability"."kind" = 'book' and "taxonomy_applicability"."level" = 'edition') or ("taxonomy_applicability"."kind" = 'perfume' and "taxonomy_applicability"."level" = 'perfume_variant') or ("taxonomy_applicability"."kind" = 'film' and "taxonomy_applicability"."level" = 'film_version') or ("taxonomy_applicability"."kind" = 'painting' and "taxonomy_applicability"."level" = 'art_object'))
);
--> statement-breakpoint
ALTER TABLE "taxonomy_applicability" ADD CONSTRAINT "taxonomy_applicability_family_id_taxonomy_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."taxonomy_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "taxonomy_applicability_scope_idx" ON "taxonomy_applicability" USING btree ("kind","level","family_id");
--> statement-breakpoint
-- Preserve the declared legacy level and every observed assignment.
INSERT INTO taxonomy_applicability(family_id,kind,level)
 SELECT id,'book',entity_level FROM taxonomy_families;
--> statement-breakpoint
INSERT INTO taxonomy_applicability(family_id,kind,level)
 SELECT DISTINCT i.family_id,w.kind,'work' FROM custom_taxonomy_item_works l JOIN custom_taxonomy_items i ON i.id=l.item_id JOIN works w ON w.id=l.work_id ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO taxonomy_applicability(family_id,kind,level)
 SELECT DISTINCT i.family_id,'book'::work_kind_enum,'edition' FROM custom_taxonomy_item_editions l JOIN custom_taxonomy_items i ON i.id=l.item_id ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO taxonomy_applicability(family_id,kind,level)
 SELECT f.id,k::work_kind_enum,'work' FROM taxonomy_families f CROSS JOIN unnest(ARRAY['film','perfume','painting']) k WHERE f.is_system AND f.system_table IN ('subjects','themes','keywords') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO taxonomy_applicability(family_id,kind,level)
 SELECT id,'painting','work' FROM taxonomy_families WHERE is_system AND system_table IN ('art_types','art_movements') ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM taxonomy_families WHERE slug='film-genres' OR name='Film genres') THEN
  RAISE EXCEPTION 'Resolve existing taxonomy family conflicting with reserved film-genres before migration; no assignments were changed';
 END IF;
END $$;
--> statement-breakpoint
INSERT INTO taxonomy_families(name,slug,is_system,system_table,entity_level,hierarchical,sort_order) VALUES ('Film genres','film-genres',true,'custom_taxonomy_items','work',true,10);
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'film','work' FROM taxonomy_families WHERE slug='film-genres';
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM taxonomy_families WHERE slug='perfume-families' OR name='Perfume families') THEN
  RAISE EXCEPTION 'Resolve existing taxonomy family conflicting with reserved perfume-families before migration; no assignments were changed';
 END IF;
END $$;
--> statement-breakpoint
INSERT INTO taxonomy_families(name,slug,is_system,system_table,entity_level,hierarchical,sort_order) VALUES ('Perfume families','perfume-families',true,'custom_taxonomy_items','work',true,11);
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'perfume','work' FROM taxonomy_families WHERE slug='perfume-families';
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'perfume','perfume_variant' FROM taxonomy_families WHERE slug='perfume-families';
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM taxonomy_families WHERE slug='perfume-accords' OR name='Perfume accords') THEN
  RAISE EXCEPTION 'Resolve existing taxonomy family conflicting with reserved perfume-accords before migration; no assignments were changed';
 END IF;
END $$;
--> statement-breakpoint
INSERT INTO taxonomy_families(name,slug,is_system,system_table,entity_level,hierarchical,sort_order) VALUES ('Perfume accords','perfume-accords',true,'custom_taxonomy_items','work',false,12);
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'perfume','work' FROM taxonomy_families WHERE slug='perfume-accords';
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'perfume','perfume_variant' FROM taxonomy_families WHERE slug='perfume-accords';
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM taxonomy_families WHERE slug='perfume-notes' OR name='Perfume notes') THEN
  RAISE EXCEPTION 'Resolve existing taxonomy family conflicting with reserved perfume-notes before migration; no assignments were changed';
 END IF;
END $$;
--> statement-breakpoint
INSERT INTO taxonomy_families(name,slug,is_system,system_table,entity_level,hierarchical,sort_order) VALUES ('Perfume notes','perfume-notes',true,'custom_taxonomy_items','work',true,13);
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'perfume','work' FROM taxonomy_families WHERE slug='perfume-notes';
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'perfume','perfume_variant' FROM taxonomy_families WHERE slug='perfume-notes';
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM taxonomy_families WHERE slug='painting-genres' OR name='Painting genres') THEN
  RAISE EXCEPTION 'Resolve existing taxonomy family conflicting with reserved painting-genres before migration; no assignments were changed';
 END IF;
END $$;
--> statement-breakpoint
INSERT INTO taxonomy_families(name,slug,is_system,system_table,entity_level,hierarchical,sort_order) VALUES ('Painting genres','painting-genres',true,'custom_taxonomy_items','work',true,14);
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'painting','work' FROM taxonomy_families WHERE slug='painting-genres';
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM taxonomy_families WHERE slug='painting-techniques' OR name='Painting techniques') THEN
  RAISE EXCEPTION 'Resolve existing taxonomy family conflicting with reserved painting-techniques before migration; no assignments were changed';
 END IF;
END $$;
--> statement-breakpoint
INSERT INTO taxonomy_families(name,slug,is_system,system_table,entity_level,hierarchical,sort_order) VALUES ('Painting techniques','painting-techniques',true,'custom_taxonomy_items','work',true,15);
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'painting','work' FROM taxonomy_families WHERE slug='painting-techniques';
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'painting','art_object' FROM taxonomy_families WHERE slug='painting-techniques';
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM taxonomy_families WHERE slug='painting-media' OR name='Painting media') THEN
  RAISE EXCEPTION 'Resolve existing taxonomy family conflicting with reserved painting-media before migration; no assignments were changed';
 END IF;
END $$;
--> statement-breakpoint
INSERT INTO taxonomy_families(name,slug,is_system,system_table,entity_level,hierarchical,sort_order) VALUES ('Painting media','painting-media',true,'custom_taxonomy_items','work',true,16);
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'painting','work' FROM taxonomy_families WHERE slug='painting-media';
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'painting','art_object' FROM taxonomy_families WHERE slug='painting-media';
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM taxonomy_families WHERE slug='painting-supports' OR name='Painting supports') THEN
  RAISE EXCEPTION 'Resolve existing taxonomy family conflicting with reserved painting-supports before migration; no assignments were changed';
 END IF;
END $$;
--> statement-breakpoint
INSERT INTO taxonomy_families(name,slug,is_system,system_table,entity_level,hierarchical,sort_order) VALUES ('Painting supports','painting-supports',true,'custom_taxonomy_items','work',true,17);
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'painting','work' FROM taxonomy_families WHERE slug='painting-supports';
--> statement-breakpoint
INSERT INTO taxonomy_applicability SELECT id,'painting','art_object' FROM taxonomy_families WHERE slug='painting-supports';
--> statement-breakpoint
CREATE FUNCTION taxonomy_family_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO taxonomy_applicability VALUES(NEW.id,'book',NEW.entity_level);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_family_defaults AFTER INSERT ON taxonomy_families FOR EACH ROW EXECUTE FUNCTION taxonomy_family_defaults();
--> statement-breakpoint
CREATE FUNCTION taxonomy_require_scope(family_arg uuid, kind_arg work_kind_enum, level_arg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM taxonomy_applicability WHERE family_id=family_arg AND kind=kind_arg AND level=level_arg FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Taxonomy family does not apply to this domain and record level' USING ERRCODE='23514', CONSTRAINT='taxonomy_assignment_scope'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION validate_taxonomy_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE family_arg uuid; kind_arg work_kind_enum; level_arg text := TG_ARGV[1];
BEGIN
 IF TG_ARGV[0]='custom_taxonomy_items' THEN SELECT family_id INTO STRICT family_arg FROM custom_taxonomy_items WHERE id=NEW.item_id FOR SHARE;
 ELSE SELECT id INTO STRICT family_arg FROM taxonomy_families WHERE is_system AND system_table=TG_ARGV[0]; END IF;
 IF level_arg='work' THEN SELECT kind INTO STRICT kind_arg FROM works WHERE id=NEW.work_id;
 ELSE kind_arg := 'book'; END IF;
 PERFORM taxonomy_require_scope(family_arg,kind_arg,level_arg);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_assignment_scope BEFORE INSERT OR UPDATE ON work_subjects FOR EACH ROW EXECUTE FUNCTION validate_taxonomy_assignment('subjects','work');
--> statement-breakpoint
CREATE TRIGGER taxonomy_assignment_scope BEFORE INSERT OR UPDATE ON edition_genres FOR EACH ROW EXECUTE FUNCTION validate_taxonomy_assignment('genres','edition');
--> statement-breakpoint
CREATE TRIGGER taxonomy_assignment_scope BEFORE INSERT OR UPDATE ON edition_tags FOR EACH ROW EXECUTE FUNCTION validate_taxonomy_assignment('tags','edition');
--> statement-breakpoint
CREATE TRIGGER taxonomy_assignment_scope BEFORE INSERT OR UPDATE ON work_categories FOR EACH ROW EXECUTE FUNCTION validate_taxonomy_assignment('book_categories','work');
--> statement-breakpoint
CREATE TRIGGER taxonomy_assignment_scope BEFORE INSERT OR UPDATE ON work_themes FOR EACH ROW EXECUTE FUNCTION validate_taxonomy_assignment('themes','work');
--> statement-breakpoint
CREATE TRIGGER taxonomy_assignment_scope BEFORE INSERT OR UPDATE ON work_literary_movements FOR EACH ROW EXECUTE FUNCTION validate_taxonomy_assignment('literary_movements','work');
--> statement-breakpoint
CREATE TRIGGER taxonomy_assignment_scope BEFORE INSERT OR UPDATE ON work_art_types FOR EACH ROW EXECUTE FUNCTION validate_taxonomy_assignment('art_types','work');
--> statement-breakpoint
CREATE TRIGGER taxonomy_assignment_scope BEFORE INSERT OR UPDATE ON work_art_movements FOR EACH ROW EXECUTE FUNCTION validate_taxonomy_assignment('art_movements','work');
--> statement-breakpoint
CREATE TRIGGER taxonomy_assignment_scope BEFORE INSERT OR UPDATE ON work_keywords FOR EACH ROW EXECUTE FUNCTION validate_taxonomy_assignment('keywords','work');
--> statement-breakpoint
CREATE TRIGGER taxonomy_assignment_scope BEFORE INSERT OR UPDATE ON work_attributes FOR EACH ROW EXECUTE FUNCTION validate_taxonomy_assignment('attributes','work');
--> statement-breakpoint
CREATE TRIGGER taxonomy_assignment_scope BEFORE INSERT OR UPDATE ON custom_taxonomy_item_works FOR EACH ROW EXECUTE FUNCTION validate_taxonomy_assignment('custom_taxonomy_items','work');
--> statement-breakpoint
CREATE TRIGGER taxonomy_assignment_scope BEFORE INSERT OR UPDATE ON custom_taxonomy_item_editions FOR EACH ROW EXECUTE FUNCTION validate_taxonomy_assignment('custom_taxonomy_items','edition');
--> statement-breakpoint
CREATE FUNCTION taxonomy_scope_in_use(family_arg uuid,kind_arg work_kind_enum,level_arg text) RETURNS boolean LANGUAGE sql VOLATILE AS $$ SELECT EXISTS(SELECT 1 FROM work_subjects l JOIN subjects i ON i.id=l.subject_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='subjects' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM edition_genres l JOIN genres i ON i.id=l.genre_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='genres' AND level_arg='edition' AND kind_arg='book') OR EXISTS(SELECT 1 FROM edition_tags l JOIN tags i ON i.id=l.tag_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='tags' AND level_arg='edition' AND kind_arg='book') OR EXISTS(SELECT 1 FROM work_categories l JOIN book_categories i ON i.id=l.category_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='book_categories' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_themes l JOIN themes i ON i.id=l.theme_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='themes' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_literary_movements l JOIN literary_movements i ON i.id=l.literary_movement_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='literary_movements' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_art_types l JOIN art_types i ON i.id=l.art_type_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='art_types' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_art_movements l JOIN art_movements i ON i.id=l.art_movement_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='art_movements' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_keywords l JOIN keywords i ON i.id=l.keyword_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='keywords' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM work_attributes l JOIN attributes i ON i.id=l.attribute_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE f.is_system AND f.system_table='attributes' AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM custom_taxonomy_item_works l JOIN custom_taxonomy_items i ON i.id=l.item_id JOIN works w ON w.id=l.work_id JOIN taxonomy_families f ON f.id=family_arg WHERE i.family_id=family_arg AND level_arg='work' AND w.kind=kind_arg) OR EXISTS(SELECT 1 FROM custom_taxonomy_item_editions l JOIN custom_taxonomy_items i ON i.id=l.item_id JOIN taxonomy_families f ON f.id=family_arg WHERE i.family_id=family_arg AND level_arg='edition' AND kind_arg='book') $$;
--> statement-breakpoint
CREATE FUNCTION guard_taxonomy_applicability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Replace applicability scopes explicitly instead of changing their identity'; END IF;
 IF taxonomy_scope_in_use(OLD.family_id,OLD.kind,OLD.level) THEN RAISE EXCEPTION 'Remove or reassign taxonomy links before removing this scope'; END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_scope_guard BEFORE UPDATE OR DELETE ON taxonomy_applicability FOR EACH ROW EXECUTE FUNCTION guard_taxonomy_applicability();
--> statement-breakpoint
CREATE FUNCTION guard_taxonomy_family() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.is_system OR EXISTS(SELECT 1 FROM custom_taxonomy_items WHERE family_id=OLD.id) THEN RAISE EXCEPTION 'System families and families containing items cannot be deleted'; END IF;
   RETURN OLD;
 END IF;
 IF NEW.id<>OLD.id OR NEW.is_system IS DISTINCT FROM OLD.is_system OR NEW.system_table IS DISTINCT FROM OLD.system_table OR (OLD.is_system AND (NEW.slug<>OLD.slug OR NEW.hierarchical IS DISTINCT FROM OLD.hierarchical)) THEN RAISE EXCEPTION 'Taxonomy storage identity is immutable'; END IF;
 IF NEW.entity_level<>OLD.entity_level THEN RAISE EXCEPTION 'Use explicit applicability scopes instead of changing the legacy level'; END IF;
 IF OLD.hierarchical AND NOT NEW.hierarchical AND EXISTS(SELECT 1 FROM custom_taxonomy_items WHERE family_id=OLD.id AND parent_id IS NOT NULL) THEN RAISE EXCEPTION 'Remove the hierarchy before disabling it'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_family_guard BEFORE UPDATE OR DELETE ON taxonomy_families FOR EACH ROW EXECUTE FUNCTION guard_taxonomy_family();
--> statement-breakpoint
-- Invalid historical trees require explicit repair; never silently move their items.
DO $$
DECLARE table_arg text; invalid_id uuid;
BEGIN
 FOREACH table_arg IN ARRAY ARRAY['genres','book_categories','themes','literary_movements','custom_taxonomy_items'] LOOP
  EXECUTE format('WITH RECURSIVE walk AS (SELECT id AS start_id,id,parent_id,ARRAY[id] AS path,false AS cycle FROM %I UNION ALL SELECT w.start_id,p.id,p.parent_id,w.path||p.id,p.id=ANY(w.path) FROM walk w JOIN %I p ON p.id=w.parent_id WHERE NOT w.cycle) SELECT start_id FROM walk WHERE cycle LIMIT 1',table_arg,table_arg) INTO invalid_id;
  IF invalid_id IS NOT NULL THEN RAISE EXCEPTION 'Repair existing taxonomy cycle in %, item %, before migration',table_arg,invalid_id; END IF;
 END LOOP;
 SELECT c.id INTO invalid_id FROM custom_taxonomy_items c JOIN custom_taxonomy_items p ON p.id=c.parent_id WHERE c.family_id<>p.family_id LIMIT 1;
 IF invalid_id IS NOT NULL THEN RAISE EXCEPTION 'Repair cross-family taxonomy parent for item % before migration',invalid_id; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_taxonomy_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invalid boolean; parent_family uuid; supports_tree boolean;
BEGIN
 -- Serialize hierarchy edits so concurrent moves cannot form a cycle.
 PERFORM pg_advisory_xact_lock(hashtextextended('taxonomy-hierarchy:' || TG_TABLE_NAME,0));
 IF TG_TABLE_NAME='custom_taxonomy_items' THEN
   IF TG_OP='UPDATE' AND NEW.family_id<>OLD.family_id THEN RAISE EXCEPTION 'An item cannot move between taxonomy families'; END IF;
   SELECT hierarchical INTO supports_tree FROM taxonomy_families WHERE id=NEW.family_id FOR SHARE;
   IF NEW.parent_id IS NOT NULL THEN
     SELECT family_id INTO parent_family FROM custom_taxonomy_items WHERE id=NEW.parent_id;
     IF parent_family IS DISTINCT FROM NEW.family_id THEN RAISE EXCEPTION 'Choose a parent from the same taxonomy family'; END IF;
     IF NOT supports_tree THEN RAISE EXCEPTION 'This taxonomy family has no hierarchy'; END IF;
   END IF;
 END IF;
 IF NEW.parent_id IS NOT NULL THEN
   EXECUTE format('WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM %I WHERE id=$1 UNION SELECT p.id,p.parent_id FROM %I p JOIN ancestors a ON p.id=a.parent_id) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=$2)',TG_TABLE_NAME,TG_TABLE_NAME) INTO invalid USING NEW.parent_id,NEW.id;
   IF invalid THEN RAISE EXCEPTION 'Taxonomy hierarchy cannot contain a cycle'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_hierarchy_guard BEFORE INSERT OR UPDATE OF parent_id ON genres FOR EACH ROW EXECUTE FUNCTION guard_taxonomy_hierarchy();
--> statement-breakpoint
CREATE TRIGGER taxonomy_hierarchy_guard BEFORE INSERT OR UPDATE OF parent_id ON book_categories FOR EACH ROW EXECUTE FUNCTION guard_taxonomy_hierarchy();
--> statement-breakpoint
CREATE TRIGGER taxonomy_hierarchy_guard BEFORE INSERT OR UPDATE OF parent_id ON themes FOR EACH ROW EXECUTE FUNCTION guard_taxonomy_hierarchy();
--> statement-breakpoint
CREATE TRIGGER taxonomy_hierarchy_guard BEFORE INSERT OR UPDATE OF parent_id ON literary_movements FOR EACH ROW EXECUTE FUNCTION guard_taxonomy_hierarchy();
--> statement-breakpoint
CREATE TRIGGER taxonomy_hierarchy_guard BEFORE INSERT OR UPDATE OF parent_id ON custom_taxonomy_items FOR EACH ROW EXECUTE FUNCTION guard_taxonomy_hierarchy();
--> statement-breakpoint
CREATE TRIGGER taxonomy_item_family_guard BEFORE UPDATE OF family_id ON custom_taxonomy_items FOR EACH ROW EXECUTE FUNCTION guard_taxonomy_hierarchy();
--> statement-breakpoint
CREATE FUNCTION protect_art_movements_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM work_art_movements WHERE art_movement_id=OLD.id) THEN RAISE EXCEPTION 'Reassign taxonomy links and children before deleting this item'; END IF;
 RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_delete_guard BEFORE DELETE ON art_movements FOR EACH ROW EXECUTE FUNCTION protect_art_movements_delete();
--> statement-breakpoint
CREATE FUNCTION protect_art_types_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM work_art_types WHERE art_type_id=OLD.id) THEN RAISE EXCEPTION 'Reassign taxonomy links and children before deleting this item'; END IF;
 RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_delete_guard BEFORE DELETE ON art_types FOR EACH ROW EXECUTE FUNCTION protect_art_types_delete();
--> statement-breakpoint
CREATE FUNCTION protect_attributes_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM work_attributes WHERE attribute_id=OLD.id) THEN RAISE EXCEPTION 'Reassign taxonomy links and children before deleting this item'; END IF;
 RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_delete_guard BEFORE DELETE ON attributes FOR EACH ROW EXECUTE FUNCTION protect_attributes_delete();
--> statement-breakpoint
CREATE FUNCTION protect_book_categories_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM book_categories WHERE parent_id=OLD.id) OR EXISTS(SELECT 1 FROM work_categories WHERE category_id=OLD.id) THEN RAISE EXCEPTION 'Reassign taxonomy links and children before deleting this item'; END IF;
 RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_delete_guard BEFORE DELETE ON book_categories FOR EACH ROW EXECUTE FUNCTION protect_book_categories_delete();
--> statement-breakpoint
CREATE FUNCTION protect_custom_taxonomy_items_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM custom_taxonomy_items WHERE parent_id=OLD.id) OR EXISTS(SELECT 1 FROM custom_taxonomy_item_works WHERE item_id=OLD.id) OR EXISTS(SELECT 1 FROM custom_taxonomy_item_editions WHERE item_id=OLD.id) THEN RAISE EXCEPTION 'Reassign taxonomy links and children before deleting this item'; END IF;
 RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_delete_guard BEFORE DELETE ON custom_taxonomy_items FOR EACH ROW EXECUTE FUNCTION protect_custom_taxonomy_items_delete();
--> statement-breakpoint
CREATE FUNCTION protect_genres_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM genres WHERE parent_id=OLD.id) OR EXISTS(SELECT 1 FROM edition_genres WHERE genre_id=OLD.id) THEN RAISE EXCEPTION 'Reassign taxonomy links and children before deleting this item'; END IF;
 RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_delete_guard BEFORE DELETE ON genres FOR EACH ROW EXECUTE FUNCTION protect_genres_delete();
--> statement-breakpoint
CREATE FUNCTION protect_keywords_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM work_keywords WHERE keyword_id=OLD.id) THEN RAISE EXCEPTION 'Reassign taxonomy links and children before deleting this item'; END IF;
 RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_delete_guard BEFORE DELETE ON keywords FOR EACH ROW EXECUTE FUNCTION protect_keywords_delete();
--> statement-breakpoint
CREATE FUNCTION protect_literary_movements_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM literary_movements WHERE parent_id=OLD.id) OR EXISTS(SELECT 1 FROM work_literary_movements WHERE literary_movement_id=OLD.id) THEN RAISE EXCEPTION 'Reassign taxonomy links and children before deleting this item'; END IF;
 RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_delete_guard BEFORE DELETE ON literary_movements FOR EACH ROW EXECUTE FUNCTION protect_literary_movements_delete();
--> statement-breakpoint
CREATE FUNCTION protect_subjects_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM work_subjects WHERE subject_id=OLD.id) THEN RAISE EXCEPTION 'Reassign taxonomy links and children before deleting this item'; END IF;
 RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_delete_guard BEFORE DELETE ON subjects FOR EACH ROW EXECUTE FUNCTION protect_subjects_delete();
--> statement-breakpoint
CREATE FUNCTION protect_tags_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM edition_tags WHERE tag_id=OLD.id) THEN RAISE EXCEPTION 'Reassign taxonomy links and children before deleting this item'; END IF;
 RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_delete_guard BEFORE DELETE ON tags FOR EACH ROW EXECUTE FUNCTION protect_tags_delete();
--> statement-breakpoint
CREATE FUNCTION protect_themes_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM themes WHERE parent_id=OLD.id) OR EXISTS(SELECT 1 FROM work_themes WHERE theme_id=OLD.id) THEN RAISE EXCEPTION 'Reassign taxonomy links and children before deleting this item'; END IF;
 RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_delete_guard BEFORE DELETE ON themes FOR EACH ROW EXECUTE FUNCTION protect_themes_delete();
--> statement-breakpoint
-- Preserve stored legacy depths during migration; keep future hierarchy edits consistent.
CREATE FUNCTION refresh_taxonomy_depths() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 EXECUTE format('WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM %I WHERE id=$1 UNION SELECT p.id,p.parent_id FROM %I p JOIN ancestors a ON p.id=a.parent_id), descendants AS (SELECT id,(SELECT count(*)::int FROM ancestors) AS depth FROM %I WHERE id=$1 UNION ALL SELECT c.id,d.depth+1 FROM %I c JOIN descendants d ON c.parent_id=d.id) UPDATE %I t SET level=d.depth FROM descendants d WHERE t.id=d.id AND t.level IS DISTINCT FROM d.depth',TG_TABLE_NAME,TG_TABLE_NAME,TG_TABLE_NAME,TG_TABLE_NAME,TG_TABLE_NAME) USING NEW.id;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER taxonomy_depths AFTER INSERT OR UPDATE OF parent_id ON book_categories FOR EACH ROW EXECUTE FUNCTION refresh_taxonomy_depths();
--> statement-breakpoint
CREATE TRIGGER taxonomy_depths AFTER INSERT OR UPDATE OF parent_id ON themes FOR EACH ROW EXECUTE FUNCTION refresh_taxonomy_depths();
--> statement-breakpoint
CREATE TRIGGER taxonomy_depths AFTER INSERT OR UPDATE OF parent_id ON literary_movements FOR EACH ROW EXECUTE FUNCTION refresh_taxonomy_depths();

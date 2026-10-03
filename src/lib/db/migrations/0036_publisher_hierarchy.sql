CREATE TABLE "edition_enrichments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"source" text NOT NULL,
	"evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "edition_enrichment_field" CHECK ("edition_enrichments"."field" in ('imprint', 'publication_country'))
);
--> statement-breakpoint
CREATE TABLE "publisher_hierarchy_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publisher_id" uuid NOT NULL,
	"old_kind" text NOT NULL,
	"new_kind" text NOT NULL,
	"old_parent_id" uuid,
	"new_parent_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "publishing_houses" DROP CONSTRAINT "publisher_kind_parent_check";--> statement-breakpoint
ALTER TABLE "edition_enrichments" ADD CONSTRAINT "edition_enrichments_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publisher_hierarchy_changes" ADD CONSTRAINT "publisher_hierarchy_changes_publisher_id_publishing_houses_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishing_houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edition_enrichments_run_idx" ON "edition_enrichments" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "edition_enrichments_edition_idx" ON "edition_enrichments" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "publisher_hierarchy_changes_publisher_idx" ON "publisher_hierarchy_changes" USING btree ("publisher_id");--> statement-breakpoint
ALTER TABLE "publishing_houses" ADD CONSTRAINT "publisher_kind_parent_check" CHECK (("publishing_houses"."kind" = 'group' AND "publishing_houses"."parent_id" IS NULL) OR ("publishing_houses"."kind" = 'publisher' AND ("publishing_houses"."parent_id" IS NULL OR "publishing_houses"."parent_id" <> "publishing_houses"."id")) OR ("publishing_houses"."kind" = 'imprint' AND "publishing_houses"."parent_id" IS NOT NULL AND "publishing_houses"."parent_id" <> "publishing_houses"."id"));--> statement-breakpoint
-- A house and every house below it: a group's publishers and their imprints,
-- a publisher's imprints. Pages, filters and wanted editions roll up with it.
CREATE FUNCTION publisher_family(root uuid) RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
 SELECT root
 UNION SELECT id FROM publishing_houses WHERE parent_id = root
 UNION SELECT c.id FROM publishing_houses c JOIN publishing_houses p ON p.id = c.parent_id WHERE p.parent_id = root
$$;
--> statement-breakpoint
-- An imprint belongs to a publisher, a publisher to a group (or to nothing),
-- a group to nothing. Types and parents may change (ownership changes); the
-- houses below must still fit, and every change is logged.
CREATE OR REPLACE FUNCTION validate_publisher_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_kind text;
BEGIN
 IF NEW.parent_id IS NOT NULL THEN
   SELECT kind INTO parent_kind FROM publishing_houses WHERE id = NEW.parent_id;
   IF NEW.kind = 'imprint' AND parent_kind IS DISTINCT FROM 'publisher' THEN
     RAISE EXCEPTION 'An imprint belongs to a publisher';
   END IF;
   IF NEW.kind = 'publisher' AND parent_kind IS DISTINCT FROM 'group' THEN
     RAISE EXCEPTION 'A publisher belongs to a group';
   END IF;
 END IF;
 IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind AND EXISTS (
   SELECT 1 FROM publishing_houses c WHERE c.parent_id = NEW.id AND NOT (
     (NEW.kind = 'group' AND c.kind = 'publisher') OR (NEW.kind = 'publisher' AND c.kind = 'imprint')))
 THEN
   RAISE EXCEPTION 'The houses below it do not fit this type';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION log_publisher_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO publisher_hierarchy_changes (publisher_id, old_kind, new_kind, old_parent_id, new_parent_id)
 VALUES (NEW.id, OLD.kind, NEW.kind, OLD.parent_id, NEW.parent_id);
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER publisher_hierarchy_log AFTER UPDATE OF kind, parent_id ON publishing_houses
 FOR EACH ROW WHEN (OLD.kind IS DISTINCT FROM NEW.kind OR OLD.parent_id IS DISTINCT FROM NEW.parent_id)
 EXECUTE FUNCTION log_publisher_hierarchy();
--> statement-breakpoint
-- How an unconfirmed edition links to houses:
-- 1. A name (publisher or imprint text) that one house carries links to it.
-- 2. A name that several houses carry (Vintage in the UK and in the US) goes
--    to the one in the family of the edition's ISBN rule, else to the one in
--    the family of a house the other name gave.
-- 3. With no name match, the longest ISBN rule links the edition.
-- 4. A group's name is a last resort: the ISBN's house inside that group wins.
-- 5. The imprint text beats a sibling imprint the publisher text gave
--    (Vintage International over Vintage Books).
-- 6. Only the most specific house stays: an imprint, not its publisher or group.
CREATE OR REPLACE FUNCTION refresh_edition_publishers(edition_id_arg uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e editions; candidate uuid; total integer; source_name text; isbn text; rule_house uuid;
  from_publisher uuid; from_imprint uuid; pass integer; field integer;
BEGIN
 SELECT * INTO e FROM editions WHERE id = edition_id_arg FOR UPDATE;
 IF NOT FOUND OR e.publisher_links_confirmed THEN RETURN; END IF;
 DELETE FROM edition_publishers WHERE edition_id = e.id;
 isbn := edition_isbn_digits(e.isbn_13, e.isbn_10);
 IF isbn IS NOT NULL THEN
   SELECT publisher_id INTO rule_house FROM publisher_isbn_prefixes
    WHERE isbn LIKE prefix || '%' ORDER BY length(prefix) DESC LIMIT 1;
 END IF;
 FOR pass IN 1..2 LOOP
   FOR field IN 1..2 LOOP
     source_name := CASE field WHEN 1 THEN e.publisher ELSE e.imprint END;
     IF nullif(trim(source_name), '') IS NULL THEN CONTINUE; END IF;
     IF EXISTS (SELECT 1 FROM ignored_publisher_names WHERE name_key = publisher_name_key(source_name)) THEN CONTINUE; END IF;
     SELECT count(*), (array_agg(id))[1] INTO total, candidate FROM publisher_candidates(source_name) id;
     IF pass = 1 AND total <> 1 THEN CONTINUE; END IF;
     IF pass = 2 THEN
       IF total < 2 THEN CONTINUE; END IF;
       SELECT count(*), (array_agg(c))[1] INTO total, candidate FROM publisher_candidates(source_name) c
        WHERE rule_house IS NOT NULL AND c IN (SELECT publisher_family(rule_house));
       IF total <> 1 THEN
         SELECT count(*), (array_agg(c))[1] INTO total, candidate FROM publisher_candidates(source_name) c
          WHERE EXISTS (SELECT 1 FROM edition_publishers ep
            WHERE ep.edition_id = e.id AND c IN (SELECT publisher_family(ep.publisher_id)));
       END IF;
       IF total <> 1 THEN CONTINUE; END IF;
     END IF;
     INSERT INTO edition_publishers VALUES(e.id, candidate) ON CONFLICT DO NOTHING;
     IF field = 1 THEN from_publisher := candidate; ELSE from_imprint := candidate; END IF;
   END LOOP;
 END LOOP;
 IF rule_house IS NOT NULL THEN
   IF NOT EXISTS (SELECT 1 FROM edition_publishers WHERE edition_id = e.id) THEN
     INSERT INTO edition_publishers VALUES(e.id, rule_house) ON CONFLICT DO NOTHING;
   ELSIF EXISTS (SELECT 1 FROM edition_publishers ep JOIN publishing_houses h ON h.id = ep.publisher_id
       WHERE ep.edition_id = e.id AND h.kind = 'group' AND h.id <> rule_house
         AND rule_house IN (SELECT publisher_family(h.id))) THEN
     INSERT INTO edition_publishers VALUES(e.id, rule_house) ON CONFLICT DO NOTHING;
   END IF;
 END IF;
 IF from_publisher IS NOT NULL AND from_imprint IS NOT NULL AND from_publisher <> from_imprint AND EXISTS (
   SELECT 1 FROM publishing_houses a JOIN publishing_houses b ON b.parent_id = a.parent_id
   WHERE a.id = from_publisher AND b.id = from_imprint AND a.kind = 'imprint' AND b.kind = 'imprint') THEN
   DELETE FROM edition_publishers WHERE edition_id = e.id AND publisher_id = from_publisher;
 END IF;
 DELETE FROM edition_publishers ep WHERE ep.edition_id = e.id AND EXISTS (
   SELECT 1 FROM edition_publishers o WHERE o.edition_id = e.id AND o.publisher_id <> ep.publisher_id
     AND o.publisher_id IN (SELECT publisher_family(ep.publisher_id)));
END $$;
--> statement-breakpoint
-- A large restructure sets durtal.defer_publisher_refresh = 'on' for its
-- transaction and calls refresh_all_publisher_links() once at the end,
-- instead of recomputing every edition after every statement.
CREATE FUNCTION refresh_all_publisher_links() RETURNS void LANGUAGE plpgsql AS $$
DECLARE edition_id_arg uuid;
BEGIN
 FOR edition_id_arg IN SELECT id FROM editions WHERE NOT publisher_links_confirmed ORDER BY id LOOP
   PERFORM refresh_edition_publishers(edition_id_arg);
 END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION refresh_publisher_matches() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF coalesce(current_setting('durtal.defer_publisher_refresh', true), '') <> 'on' THEN
   PERFORM refresh_all_publisher_links();
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER publisher_names_changed ON publishing_houses;
--> statement-breakpoint
CREATE TRIGGER publisher_names_changed AFTER INSERT OR UPDATE OF name, kind, parent_id OR DELETE ON publishing_houses
 FOR EACH STATEMENT EXECUTE FUNCTION refresh_publisher_matches();
--> statement-breakpoint
-- A wanted edition "from this publisher" accepts every house below it
CREATE OR REPLACE FUNCTION target_accepts_edition(target_id uuid, edition_id_arg uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM acquisition_targets t JOIN editions e ON e.work_id = t.work_id
  WHERE t.id = target_id AND e.id = edition_id_arg AND
  (t.edition_id IS NULL OR t.edition_id = e.id) AND
  (t.publisher_id IS NULL OR EXISTS (
    SELECT 1 FROM edition_publishers ep
    WHERE ep.edition_id = e.id AND ep.publisher_id IN (SELECT publisher_family(t.publisher_id))
  ))
 )
$$;

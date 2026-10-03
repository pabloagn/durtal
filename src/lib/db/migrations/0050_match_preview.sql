-- Task 0184: Match with a preview.
-- 1. One stored form per binding (BINDING_TYPES). Existing values written by
--    hand or by a source ("Paperback") take their code first.
UPDATE "editions" SET "binding" = replace(lower(trim("binding")), ' ', '_') WHERE "binding" IS NOT NULL;--> statement-breakpoint
UPDATE "editions" SET "binding" = NULL WHERE "binding" = '';--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_binding_check" CHECK ("editions"."binding" in ('hardcover', 'paperback', 'leather', 'cloth', 'boards', 'wrappers', 'spiral', 'saddle_stitch', 'other'));--> statement-breakpoint
-- 2. The houses a publisher text, an imprint text and an ISBN link to, without
--    writing anything: Match shows them before it saves. The rules are the
--    ones of 0036, moved here unchanged; refresh_edition_publishers now only
--    stores this function's answer.
CREATE FUNCTION edition_publisher_matches(publisher_arg text, imprint_arg text, isbn text) RETURNS uuid[] LANGUAGE plpgsql STABLE AS $$
DECLARE found uuid[] := '{}'; candidate uuid; total integer; source_name text; rule_house uuid;
  from_publisher uuid; from_imprint uuid; pass integer; field integer;
BEGIN
 IF isbn IS NOT NULL THEN
   SELECT publisher_id INTO rule_house FROM publisher_isbn_prefixes
    WHERE isbn LIKE prefix || '%' ORDER BY length(prefix) DESC LIMIT 1;
 END IF;
 FOR pass IN 1..2 LOOP
   FOR field IN 1..2 LOOP
     source_name := CASE field WHEN 1 THEN publisher_arg ELSE imprint_arg END;
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
          WHERE EXISTS (SELECT 1 FROM unnest(found) f WHERE c IN (SELECT publisher_family(f)));
       END IF;
       IF total <> 1 THEN CONTINUE; END IF;
     END IF;
     IF NOT candidate = ANY (found) THEN found := found || candidate; END IF;
     IF field = 1 THEN from_publisher := candidate; ELSE from_imprint := candidate; END IF;
   END LOOP;
 END LOOP;
 IF rule_house IS NOT NULL AND NOT rule_house = ANY (found) THEN
   IF cardinality(found) = 0 THEN
     found := ARRAY[rule_house];
   ELSIF EXISTS (SELECT 1 FROM unnest(found) f JOIN publishing_houses h ON h.id = f
       WHERE h.kind = 'group' AND h.id <> rule_house
         AND rule_house IN (SELECT publisher_family(h.id))) THEN
     found := found || rule_house;
   END IF;
 END IF;
 IF from_publisher IS NOT NULL AND from_imprint IS NOT NULL AND from_publisher <> from_imprint AND EXISTS (
   SELECT 1 FROM publishing_houses a JOIN publishing_houses b ON b.parent_id = a.parent_id
   WHERE a.id = from_publisher AND b.id = from_imprint AND a.kind = 'imprint' AND b.kind = 'imprint') THEN
   found := array_remove(found, from_publisher);
 END IF;
 SELECT coalesce(array_agg(f ORDER BY n), '{}') INTO found FROM unnest(found) WITH ORDINALITY AS t(f, n)
  WHERE NOT EXISTS (SELECT 1 FROM unnest(found) o WHERE o <> t.f AND o IN (SELECT publisher_family(t.f)));
 RETURN found;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION refresh_edition_publishers(edition_id_arg uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e editions;
BEGIN
 SELECT * INTO e FROM editions WHERE id = edition_id_arg FOR UPDATE;
 IF NOT FOUND OR e.publisher_links_confirmed THEN RETURN; END IF;
 DELETE FROM edition_publishers WHERE edition_id = e.id;
 INSERT INTO edition_publishers
  SELECT e.id, h FROM unnest(edition_publisher_matches(e.publisher, e.imprint, edition_isbn_digits(e.isbn_13, e.isbn_10))) h
  ON CONFLICT DO NOTHING;
END $$;

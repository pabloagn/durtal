ALTER TABLE "works" ADD CONSTRAINT "works_book_series_check" CHECK ("works"."kind" = 'book' OR ("works"."series_id" IS NULL AND "works"."series_name" IS NULL AND "works"."series_position" IS NULL));
--> statement-breakpoint
-- These are publication relationships, not generic work relationships. Kind is
-- immutable (0033), so validating the parent on insertion/reparenting is enough
-- for its lifetime. Keep the existing FKs and their cascade semantics intact.
-- Triggers are custom SQL because Drizzle does not model them in snapshots.
CREATE FUNCTION require_book_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.work_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM works WHERE id = NEW.work_id AND kind = 'book'
  ) THEN
    RAISE EXCEPTION '% requires an existing book', TG_TABLE_NAME
      USING ERRCODE = '23514', CONSTRAINT = 'book_parent_required';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE relation_name text;
DECLARE invalid_parent boolean;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'editions', 'work_authors', 'acquisition_targets', 'orders',
    'calibre_books', 'work_status_history'
  ] LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I r JOIN works w ON w.id = r.work_id WHERE w.kind <> ''book'')',
      relation_name
    ) INTO invalid_parent;
    IF invalid_parent THEN
      RAISE EXCEPTION 'Non-book parent in %, reconcile before migrating', relation_name;
    END IF;
    EXECUTE format(
      'CREATE TRIGGER book_parent_required BEFORE INSERT OR UPDATE OF work_id ON %I FOR EACH ROW EXECUTE FUNCTION require_book_parent()',
      relation_name
    );
  END LOOP;
END;
$$;

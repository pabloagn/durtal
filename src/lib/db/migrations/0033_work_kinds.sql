CREATE TYPE "public"."work_kind_enum" AS ENUM('book', 'film', 'perfume', 'painting');--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "kind" "work_kind_enum" DEFAULT 'book' NOT NULL;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_kind_enabled_check" CHECK ("works"."kind" = 'book');--> statement-breakpoint
-- Preserve domain identity after future migrations enable additional kinds.
-- Drizzle does not model triggers; keep this invariant in migration SQL.
CREATE FUNCTION prevent_work_kind_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'A work cannot change its kind'
      USING ERRCODE = '23514', CONSTRAINT = 'works_kind_immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER works_kind_immutable
BEFORE UPDATE OF kind ON works
FOR EACH ROW EXECUTE FUNCTION prevent_work_kind_change();

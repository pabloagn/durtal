-- REVIEW PROPOSAL ONLY. Not in migrations and never applied by this source.
-- Root inserts these statements into generated 0082 after independent review.
-- Backfill MUST precede adding ebooks_exclusion_presence_check.
-- Preflight MUST precede adding ebooks_match_probability_check. Existing bad
-- values require an explicit reviewed reconciliation; do not silently clamp.
DO $$
DECLARE invalid_ids uuid[];
BEGIN
  SELECT array_agg(id ORDER BY id) INTO invalid_ids FROM ebooks
  WHERE match_probability IS NOT NULL AND (
    match_probability IN ('NaN'::real, 'Infinity'::real, '-Infinity'::real)
    OR match_probability < 0 OR match_probability > 1
  );
  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Reconcile invalid ebooks.match_probability before 0082: %', invalid_ids;
  END IF;
END;
$$;

UPDATE ebooks SET exclusion_reason = 'other'
WHERE match_state = 'excluded' AND exclusion_reason IS NULL;

CREATE TRIGGER book_parent_required
BEFORE INSERT OR UPDATE OF work_id ON ebook_match_candidates
FOR EACH ROW EXECUTE FUNCTION require_book_parent();

CREATE FUNCTION require_ebook_candidate_refs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Edition deletion's SET NULL may precede instance deletion's SET NULL.
  -- Clear the instance too only when its formerly selected edition is gone.
  IF NEW.edition_id IS NULL AND NEW.instance_id IS NOT NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.edition_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM editions WHERE id = OLD.edition_id) THEN
      NEW.instance_id := NULL;
    ELSE
      RAISE EXCEPTION 'A candidate copy needs its edition'
      USING ERRCODE = '23514', CONSTRAINT = 'ebook_candidate_refs';
    END IF;
  END IF;
  IF NEW.edition_id IS NOT NULL THEN
    PERFORM 1 FROM editions WHERE id = NEW.edition_id AND work_id = NEW.work_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A candidate edition must belong to its book'
      USING ERRCODE = '23514', CONSTRAINT = 'ebook_candidate_refs';
    END IF;
  END IF;
  IF NEW.instance_id IS NOT NULL THEN
    PERFORM 1 FROM instances i JOIN editions e ON e.id = i.edition_id
    WHERE i.id = NEW.instance_id AND i.edition_id = NEW.edition_id AND e.work_id = NEW.work_id
    FOR SHARE OF i, e;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A candidate copy must belong to its selected edition and book'
      USING ERRCODE = '23514', CONSTRAINT = 'ebook_candidate_refs';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ebook_candidate_refs
BEFORE INSERT OR UPDATE OF work_id, edition_id, instance_id ON ebook_match_candidates
FOR EACH ROW EXECUTE FUNCTION require_ebook_candidate_refs();

-- FOR SHARE above conflicts with non-key reparent updates, so an insertion
-- cannot commit a stale relationship while these AFTER triggers invalidate it.
CREATE FUNCTION invalidate_ebook_candidate_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_ids uuid[];
DECLARE parent_id uuid;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  IF TG_TABLE_NAME = 'editions' THEN
    IF TG_OP = 'UPDATE' AND NEW.work_id IS NOT DISTINCT FROM OLD.work_id THEN RETURN NEW; END IF;
    SELECT array_agg(DISTINCT c.ebook_id) INTO affected_ids FROM ebook_match_candidates c
    WHERE c.edition_id = parent_id OR c.instance_id IN (SELECT id FROM instances WHERE edition_id = parent_id);
  ELSE
    IF TG_OP = 'UPDATE' AND NEW.edition_id IS NOT DISTINCT FROM OLD.edition_id THEN RETURN NEW; END IF;
    SELECT array_agg(DISTINCT c.ebook_id) INTO affected_ids FROM ebook_match_candidates c
    WHERE c.instance_id = parent_id;
  END IF;
  IF affected_ids IS NOT NULL THEN
    UPDATE ebooks SET match_tier = NULL, match_model_version = NULL, duplicate_of_id = NULL, updated_at = now()
    WHERE id = ANY(affected_ids) AND match_state = 'pending';
    DELETE FROM ebook_match_candidates WHERE ebook_id = ANY(affected_ids);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ebook_candidate_edition_reparented
AFTER UPDATE OF work_id ON editions
FOR EACH ROW EXECUTE FUNCTION invalidate_ebook_candidate_parent();
CREATE TRIGGER ebook_candidate_edition_deleted
BEFORE DELETE ON editions
FOR EACH ROW EXECUTE FUNCTION invalidate_ebook_candidate_parent();
CREATE TRIGGER ebook_candidate_copy_deleted
BEFORE DELETE ON instances
FOR EACH ROW EXECUTE FUNCTION invalidate_ebook_candidate_parent();
CREATE TRIGGER ebook_candidate_copy_reparented
AFTER UPDATE OF edition_id ON instances
FOR EACH ROW EXECUTE FUNCTION invalidate_ebook_candidate_parent();

CREATE OR REPLACE FUNCTION ebook_copy_removed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.instance_id IS NOT NULL AND NEW.instance_id IS NULL AND NEW.match_state = 'linked' THEN
    NEW.match_state := 'pending';
    NEW.match_method := NULL;
    NEW.match_probability := NULL;
    NEW.matched_at := NULL;
    NEW.match_tier := NULL;
    NEW.match_model_version := NULL;
    NEW.duplicate_of_id := NULL;
    NEW.link_written := NULL;
    NEW.exclusion_reason := NULL;
    NEW.updated_at := now();
    DELETE FROM ebook_match_candidates WHERE ebook_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION ebook_duplicate_removed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.duplicate_of_id IS NOT NULL AND NEW.duplicate_of_id IS NULL
     AND NEW.match_tier = 'duplicate' THEN
    NEW.match_tier := NULL;
    NEW.match_model_version := NULL;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ebook_duplicate_removed
BEFORE UPDATE OF duplicate_of_id ON ebooks
FOR EACH ROW EXECUTE FUNCTION ebook_duplicate_removed();

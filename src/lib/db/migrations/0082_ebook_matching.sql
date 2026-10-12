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
--> statement-breakpoint
CREATE TABLE "ebook_match_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ebook_id" uuid NOT NULL,
	"rank" smallint NOT NULL,
	"work_id" uuid NOT NULL,
	"edition_id" uuid,
	"instance_id" uuid,
	"edition_rule" text NOT NULL,
	"probability" real NOT NULL,
	"weight_bits" real NOT NULL,
	"margin_bits" real,
	"reasons" jsonb NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"model_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebook_match_candidates_rank_unique" UNIQUE("ebook_id","rank"),
	CONSTRAINT "ebook_match_candidates_rank_check" CHECK ("ebook_match_candidates"."rank" between 1 and 3),
	CONSTRAINT "ebook_match_candidates_rule_check" CHECK ("ebook_match_candidates"."edition_rule" in ('isbn_edition','fill_copy','new_isbn_edition','placeholder_copy','new_edition')),
	CONSTRAINT "ebook_match_candidates_probability_check" CHECK ("ebook_match_candidates"."probability" not in ('NaN'::real, 'Infinity'::real, '-Infinity'::real) and "ebook_match_candidates"."probability" between 0 and 1),
	CONSTRAINT "ebook_match_candidates_weight_check" CHECK ("ebook_match_candidates"."weight_bits" not in ('NaN'::real, 'Infinity'::real, '-Infinity'::real)),
	CONSTRAINT "ebook_match_candidates_margin_check" CHECK ("ebook_match_candidates"."margin_bits" is null or ("ebook_match_candidates"."rank" = 1 and "ebook_match_candidates"."margin_bits" not in ('NaN'::real, 'Infinity'::real, '-Infinity'::real))),
	CONSTRAINT "ebook_match_candidates_reasons_check" CHECK (jsonb_typeof("ebook_match_candidates"."reasons") = 'array'),
	CONSTRAINT "ebook_match_candidates_flags_check" CHECK ("ebook_match_candidates"."flags" <@ ARRAY['omnibus','sample','periodical','article','shared_isbn']::text[]),
	CONSTRAINT "ebook_match_candidates_model_check" CHECK ("ebook_match_candidates"."model_version" > 0),
	CONSTRAINT "ebook_match_candidates_instance_edition_check" CHECK ("ebook_match_candidates"."instance_id" is null or "ebook_match_candidates"."edition_id" is not null)
);

--> statement-breakpoint
ALTER TABLE "ebooks" ADD COLUMN "match_tier" text;
--> statement-breakpoint
ALTER TABLE "ebooks" ADD COLUMN "match_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "ebooks" ADD COLUMN "match_model_version" integer;
--> statement-breakpoint
ALTER TABLE "ebooks" ADD COLUMN "duplicate_of_id" uuid;
--> statement-breakpoint
ALTER TABLE "ebooks" ADD COLUMN "link_written" jsonb;
--> statement-breakpoint
ALTER TABLE "ebooks" ADD COLUMN "exclusion_reason" text;
--> statement-breakpoint


UPDATE ebooks SET exclusion_reason = 'other'
WHERE match_state = 'excluded' AND exclusion_reason IS NULL;
--> statement-breakpoint
ALTER TABLE "ebook_match_candidates" ADD CONSTRAINT "ebook_match_candidates_ebook_id_ebooks_id_fk" FOREIGN KEY ("ebook_id") REFERENCES "public"."ebooks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ebook_match_candidates" ADD CONSTRAINT "ebook_match_candidates_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ebook_match_candidates" ADD CONSTRAINT "ebook_match_candidates_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ebook_match_candidates" ADD CONSTRAINT "ebook_match_candidates_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ebook_match_candidates_work_idx" ON "ebook_match_candidates" USING btree ("work_id");
--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_duplicate_of_id_ebooks_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."ebooks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_match_probability_check" CHECK ("ebooks"."match_probability" is null or ("ebooks"."match_probability" not in ('NaN'::real, 'Infinity'::real, '-Infinity'::real) and "ebooks"."match_probability" between 0 and 1));
--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_match_tier_check" CHECK ("ebooks"."match_tier" is null or ("ebooks"."match_state"='pending' and "ebooks"."match_tier" in ('exact','strong','likely','to_choose','same_author','conflict','duplicate','not_a_book','not_in_durtal')));
--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_match_fingerprint_check" CHECK ("ebooks"."match_fingerprint" is null or "ebooks"."match_fingerprint" ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_match_model_version_check" CHECK ("ebooks"."match_model_version" is null or "ebooks"."match_model_version" > 0);
--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_duplicate_check" CHECK ("ebooks"."duplicate_of_id" is null or ("ebooks"."duplicate_of_id" <> "ebooks"."id" and "ebooks"."match_state"='pending' and "ebooks"."match_tier" is not null and "ebooks"."match_tier"='duplicate'));
--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_link_written_check" CHECK ("ebooks"."link_written" is null or jsonb_typeof("ebooks"."link_written")='object');
--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_exclusion_reason_check" CHECK ("ebooks"."exclusion_reason" is null or "ebooks"."exclusion_reason" in ('duplicate','not_a_book','other'));
--> statement-breakpoint
ALTER TABLE "ebooks" ADD CONSTRAINT "ebooks_exclusion_presence_check" CHECK (("ebooks"."match_state"='excluded') = ("ebooks"."exclusion_reason" is not null));
--> statement-breakpoint


CREATE TRIGGER book_parent_required
BEFORE INSERT OR UPDATE OF work_id ON ebook_match_candidates
FOR EACH ROW EXECUTE FUNCTION require_book_parent();
--> statement-breakpoint


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
--> statement-breakpoint

CREATE TRIGGER ebook_candidate_refs
BEFORE INSERT OR UPDATE OF work_id, edition_id, instance_id ON ebook_match_candidates
FOR EACH ROW EXECUTE FUNCTION require_ebook_candidate_refs();
--> statement-breakpoint


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
--> statement-breakpoint

CREATE TRIGGER ebook_candidate_edition_reparented
AFTER UPDATE OF work_id ON editions
FOR EACH ROW EXECUTE FUNCTION invalidate_ebook_candidate_parent();
--> statement-breakpoint

CREATE TRIGGER ebook_candidate_edition_deleted
BEFORE DELETE ON editions
FOR EACH ROW EXECUTE FUNCTION invalidate_ebook_candidate_parent();
--> statement-breakpoint

CREATE TRIGGER ebook_candidate_copy_deleted
BEFORE DELETE ON instances
FOR EACH ROW EXECUTE FUNCTION invalidate_ebook_candidate_parent();
--> statement-breakpoint

CREATE TRIGGER ebook_candidate_copy_reparented
AFTER UPDATE OF edition_id ON instances
FOR EACH ROW EXECUTE FUNCTION invalidate_ebook_candidate_parent();
--> statement-breakpoint


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
--> statement-breakpoint


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
--> statement-breakpoint

CREATE TRIGGER ebook_duplicate_removed
BEFORE UPDATE OF duplicate_of_id ON ebooks
FOR EACH ROW EXECUTE FUNCTION ebook_duplicate_removed();


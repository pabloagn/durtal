-- Custom preflight for 0083; prepend only after genuine generation and review.
-- Execute both statements separately in ONE explicit READ COMMITTED transaction.
-- Retain this lock through all annotation DDL/backfill and migration COMMIT/ROLLBACK.
LOCK TABLE public.ebook_annotations IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $reader_legacy_quote_preflight$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Reader migration requires a Read Committed transaction'
      USING ERRCODE = '25000';
  END IF;

  -- Include deleted quotes: historical association is required for tombstones too.
  IF EXISTS (SELECT 1 FROM public.ebook_annotations WHERE style = 'quote') THEN
    RAISE EXCEPTION 'Verified legacy quote association recovery required before 0083'
      USING ERRCODE = '23514',
            CONSTRAINT = 'reader_legacy_quote_reconciliation_required';
  END IF;
END;
$reader_legacy_quote_preflight$;

--> statement-breakpoint
-- EXACT REVIEW PROPOSAL ONLY. Not a generated migration; do not apply.
-- Reserved 0083. 0082 belongs to SLN-495. No journal/snapshot is changed here.
-- Declaration correspondence: src/lib/db/schema/ebook-annotations.ts.
-- On approval, prepend the locator function before generated CHECK DDL, then
-- append these lifecycle functions/triggers. Rehearse existing rows from a dump;
-- refuse invalid data, never truncate passages/notes or silently repair anchors.
-- Writer/pull transactions are READ COMMITTED, via the existing Neon atomic
-- batch. Lock book, then all affected UUIDs in ascending order before row locks.
-- https://www.postgresql.org/docs/16/transaction-iso.html
-- https://www.postgresql.org/docs/16/explicit-locking.html
-- https://www.postgresql.org/docs/16/xfunc-volatility.html

CREATE FUNCTION public.durtal_annotation_locator_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, public AS $$
DECLARE k text; part jsonb; rect jsonb; coordinate jsonb;
BEGIN
  IF jsonb_typeof(v) <> 'object' OR
     v - ARRAY['v','fileHash','href','sectionIndex','progression','totalProgression','position','cfi','pdf','text','tocLabel','pageLabel'] <> '{}'::jsonb OR
     v->'v' IS DISTINCT FROM '1'::jsonb OR
     jsonb_typeof(v->'fileHash') IS DISTINCT FROM 'string' OR (v->>'fileHash') !~ '^[0-9a-f]{64}$' OR
     jsonb_typeof(v->'href') IS DISTINCT FROM 'string' OR char_length(v->>'href') > 2048 THEN RETURN false; END IF;
  FOR k IN SELECT unnest(ARRAY['sectionIndex','progression','totalProgression']) LOOP
    IF jsonb_typeof(v->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  END LOOP;
  IF (v->>'sectionIndex')::numeric < 0 OR (v->>'sectionIndex')::numeric > 9007199254740991 OR
     trunc((v->>'sectionIndex')::numeric) <> (v->>'sectionIndex')::numeric OR
     (v->>'progression')::numeric NOT BETWEEN 0 AND 1 OR (v->>'totalProgression')::numeric NOT BETWEEN 0 AND 1 THEN RETURN false; END IF;
  IF v ? 'position' AND (jsonb_typeof(v->'position') IS DISTINCT FROM 'number' OR
     (v->>'position')::numeric < 0 OR (v->>'position')::numeric > 9007199254740991 OR
     trunc((v->>'position')::numeric) <> (v->>'position')::numeric) THEN RETURN false; END IF;
  FOR k IN SELECT unnest(ARRAY['cfi','tocLabel','pageLabel']) LOOP
    IF v ? k AND (jsonb_typeof(v->k) IS DISTINCT FROM 'string' OR
      char_length(v->>k) > CASE k WHEN 'cfi' THEN 4096 WHEN 'tocLabel' THEN 300 ELSE 40 END) THEN RETURN false; END IF;
  END LOOP;
  IF v ? 'text' THEN
    part := v->'text';
    IF jsonb_typeof(part) <> 'object' OR part - ARRAY['before','highlight','after'] <> '{}'::jsonb THEN RETURN false; END IF;
    FOR k IN SELECT unnest(ARRAY['before','highlight','after']) LOOP
      IF part ? k AND (jsonb_typeof(part->k) IS DISTINCT FROM 'string' OR
        char_length(part->>k) > CASE k WHEN 'highlight' THEN 10000 ELSE 64 END) THEN RETURN false; END IF;
    END LOOP;
  END IF;
  IF v ? 'pdf' THEN
    part := v->'pdf';
    IF jsonb_typeof(part) <> 'object' OR part - ARRAY['page','rects'] <> '{}'::jsonb OR
       jsonb_typeof(part->'page') IS DISTINCT FROM 'number' OR (part->>'page')::numeric < 1 OR
       (part->>'page')::numeric > 9007199254740991 OR trunc((part->>'page')::numeric) <> (part->>'page')::numeric THEN RETURN false; END IF;
    IF part ? 'rects' THEN
      IF jsonb_typeof(part->'rects') <> 'array' OR jsonb_array_length(part->'rects') > 200 THEN RETURN false; END IF;
      FOR rect IN SELECT value FROM jsonb_array_elements(part->'rects') LOOP
        IF jsonb_typeof(rect) <> 'array' OR jsonb_array_length(rect) <> 4 THEN RETURN false; END IF;
        FOR coordinate IN SELECT value FROM jsonb_array_elements(rect) LOOP
          IF jsonb_typeof(coordinate) <> 'number' OR abs((coordinate #>> '{}')::numeric) > 1.7976931348623157e308 THEN RETURN false; END IF;
        END LOOP;
      END LOOP;
    END IF;
  END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE TABLE "ebook_annotation_cursors" (
	"ebook_id" uuid PRIMARY KEY NOT NULL,
	"server_time" timestamp(6) with time zone NOT NULL,
	CONSTRAINT "ebook_annotation_cursors_time_check" CHECK (isfinite("ebook_annotation_cursors"."server_time"))
);
--> statement-breakpoint
CREATE TABLE "ebook_annotation_retired_ids" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ebook_id" uuid NOT NULL,
	"retired_at" timestamp(6) with time zone NOT NULL,
	CONSTRAINT "ebook_annotation_retired_ids_time_check" CHECK (isfinite("ebook_annotation_retired_ids"."retired_at"))
);
--> statement-breakpoint
ALTER TABLE "ebook_annotations" ALTER COLUMN "client_updated_at" SET DATA TYPE timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "ebook_annotations" ALTER COLUMN "created_at" SET DATA TYPE timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "ebook_annotations" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ebook_annotations" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "ebook_annotations" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ebook_annotations" ALTER COLUMN "deleted_at" SET DATA TYPE timestamp(6) with time zone;--> statement-breakpoint
ALTER TABLE "ebook_annotations" ADD COLUMN "quote_binding_version" uuid;--> statement-breakpoint
ALTER TABLE "ebook_annotation_cursors" ADD CONSTRAINT "ebook_annotation_cursors_ebook_id_ebooks_id_fk" FOREIGN KEY ("ebook_id") REFERENCES "public"."ebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_annotation_retired_ids" ADD CONSTRAINT "ebook_annotation_retired_ids_ebook_id_ebooks_id_fk" FOREIGN KEY ("ebook_id") REFERENCES "public"."ebooks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ebook_annotation_retired_ids_ebook_idx" ON "ebook_annotation_retired_ids" USING btree ("ebook_id");--> statement-breakpoint
CREATE INDEX "ebook_annotations_sync_idx" ON "ebook_annotations" USING btree ("ebook_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "ebook_annotations_search_idx" ON "ebook_annotations" USING gin ((public.search_normalize(coalesce("text", '') || ' ' || coalesce("note", ''))) gin_trgm_ops) WHERE "ebook_annotations"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "ebook_annotations" ADD CONSTRAINT "ebook_annotations_note_check" CHECK ("ebook_annotations"."note" is null or char_length("ebook_annotations"."note") <= 10000);--> statement-breakpoint
ALTER TABLE "ebook_annotations" ADD CONSTRAINT "ebook_annotations_chapter_check" CHECK ("ebook_annotations"."chapter" is null or char_length("ebook_annotations"."chapter") <= 300);--> statement-breakpoint
ALTER TABLE "ebook_annotations" ADD CONSTRAINT "ebook_annotations_progression_check" CHECK ("ebook_annotations"."progression" between 0 and 1);--> statement-breakpoint
ALTER TABLE "ebook_annotations" ADD CONSTRAINT "ebook_annotations_locator_check" CHECK (public.durtal_annotation_locator_valid("ebook_annotations"."locator"));--> statement-breakpoint
ALTER TABLE "ebook_annotations" ADD CONSTRAINT "ebook_annotations_metadata_check" CHECK (
    ("ebook_annotations"."kind" = 'bookmark' and "ebook_annotations"."style" = 'highlight' and "ebook_annotations"."color" is null and "ebook_annotations"."text" is null and "ebook_annotations"."note" is null and "ebook_annotations"."quote_binding_version" is null)
    or ("ebook_annotations"."kind" = 'highlight' and "ebook_annotations"."text" is not null and char_length("ebook_annotations"."text") between 1 and 10000 and btrim("ebook_annotations"."text") <> ''
      and ("ebook_annotations"."locator" #>> '{text,highlight}') is not null and btrim("ebook_annotations"."locator" #>> '{text,highlight}') <> ''
      and (("ebook_annotations"."style" = 'quote' and "ebook_annotations"."color" is null and "ebook_annotations"."quote_binding_version" is not null)
        or ("ebook_annotations"."style" in ('highlight', 'underline') and "ebook_annotations"."color" is not null and "ebook_annotations"."quote_binding_version" is null))));--> statement-breakpoint
ALTER TABLE "ebook_annotations" ADD CONSTRAINT "ebook_annotations_time_check" CHECK (isfinite("ebook_annotations"."client_updated_at") and isfinite("ebook_annotations"."created_at") and isfinite("ebook_annotations"."updated_at") and ("ebook_annotations"."deleted_at" is null or isfinite("ebook_annotations"."deleted_at")) and "ebook_annotations"."created_at" <= "ebook_annotations"."updated_at" and ("ebook_annotations"."deleted_at" is null or "ebook_annotations"."deleted_at" <= "ebook_annotations"."updated_at"));
--> statement-breakpoint


CREATE FUNCTION public.durtal_annotation_lock_book(p_ebook_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $$
BEGIN
  -- Per-ID lock wait must be followed by a fresh snapshot to observe another
  -- book's committed retirement. Do not run this protocol at REPEATABLE READ.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Annotation protocol requires READ COMMITTED' USING ERRCODE = '25000';
  END IF;
  -- Stabilize the real catalogue relation before the cursor/annotation/note
  -- locks. 0087 binding writers must follow this same order. FOR SHARE blocks
  -- concurrent relinking, not merely deletion of the referenced primary key.
  PERFORM 1 FROM public.ebooks WHERE id = p_ebook_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown e-book' USING ERRCODE = '23503'; END IF;
  PERFORM 1 FROM public.ebooks eb JOIN public.instances i ON i.id = eb.instance_id
    JOIN public.editions ed ON ed.id = i.edition_id WHERE eb.id = p_ebook_id FOR SHARE OF i, ed;
  INSERT INTO public.ebook_annotation_cursors (ebook_id, server_time)
    SELECT p_ebook_id, greatest(clock_timestamp(), coalesce(max(updated_at), clock_timestamp()))
      FROM public.ebook_annotations WHERE ebook_id = p_ebook_id
    ON CONFLICT (ebook_id) DO NOTHING;
  PERFORM 1 FROM public.ebook_annotation_cursors WHERE ebook_id = p_ebook_id FOR UPDATE;
END $$;
--> statement-breakpoint


CREATE FUNCTION public.durtal_annotation_lock_id(p_id uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, public AS $$
  SELECT pg_advisory_xact_lock(hashtextextended(p_id::text, 500));
$$;
--> statement-breakpoint


CREATE FUNCTION public.durtal_annotation_tick(p_ebook_id uuid) RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $$
DECLARE stamp timestamptz;
BEGIN
  PERFORM public.durtal_annotation_lock_book(p_ebook_id);
  UPDATE public.ebook_annotation_cursors SET server_time = greatest(clock_timestamp(), server_time + interval '1 microsecond')
    WHERE ebook_id = p_ebook_id RETURNING server_time INTO stamp;
  RETURN stamp;
END $$;
--> statement-breakpoint


CREATE FUNCTION public.durtal_annotation_cursor_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.ebooks WHERE id = OLD.ebook_id) THEN
      RAISE EXCEPTION 'Annotation cursor cannot be reset' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_cursor_monotonic';
    END IF;
    RETURN OLD; -- only the owning e-book's real deletion may cascade this clock
  END IF;
  IF NEW.ebook_id <> OLD.ebook_id OR NEW.server_time < OLD.server_time THEN
    RAISE EXCEPTION 'Annotation cursor cannot regress' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_cursor_monotonic';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER ebook_annotation_cursor_monotonic BEFORE UPDATE OR DELETE ON public.ebook_annotation_cursors
FOR EACH ROW EXECUTE FUNCTION public.durtal_annotation_cursor_guard();
--> statement-breakpoint


-- TRUNCATE does not invoke the cursor DELETE guard. Protect its clock even
-- for an empty table and when an owning table is truncated with CASCADE.
CREATE FUNCTION public.durtal_annotation_cursor_truncate_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Annotation cursors cannot be truncated'
    USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_cursor_no_truncate';
END $$;
--> statement-breakpoint

CREATE TRIGGER ebook_annotation_cursor_no_truncate BEFORE TRUNCATE ON public.ebook_annotation_cursors
FOR EACH STATEMENT EXECUTE FUNCTION public.durtal_annotation_cursor_truncate_guard();
--> statement-breakpoint


CREATE FUNCTION public.durtal_annotation_retirement_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $$
DECLARE owner uuid; stamp timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Retired annotation identities are immutable' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_retirement_immutable';
  END IF;
  PERFORM public.durtal_annotation_lock_book(NEW.ebook_id);
  PERFORM public.durtal_annotation_lock_id(NEW.id);
  SELECT ebook_id INTO owner FROM public.ebook_annotation_retired_ids WHERE id = NEW.id;
  IF FOUND THEN
    IF owner <> NEW.ebook_id THEN RAISE EXCEPTION 'Annotation belongs to another book' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_identity_owner'; END IF;
    RETURN NULL; -- repeated retirement never changes its original timestamp
  END IF;
  SELECT ebook_id INTO owner FROM public.ebook_annotations WHERE id = NEW.id;
  IF FOUND AND owner <> NEW.ebook_id THEN RAISE EXCEPTION 'Annotation belongs to another book' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_identity_owner'; END IF;
  SELECT server_time INTO stamp FROM public.ebook_annotation_cursors WHERE ebook_id = NEW.ebook_id;
  IF NEW.retired_at > stamp THEN RAISE EXCEPTION 'Retirement exceeds book cursor' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_retirement_cursor'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER ebook_annotation_retirement_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.ebook_annotation_retired_ids
FOR EACH ROW EXECUTE FUNCTION public.durtal_annotation_retirement_guard();
--> statement-breakpoint


-- TRUNCATE bypasses row-level INSERT/UPDATE/DELETE triggers, including CASCADE.
-- Reject it at statement level even when empty; no application reset may erase
-- this ledger. Disposable test teardown must drop/recreate its isolated database.
CREATE FUNCTION public.durtal_annotation_retirement_truncate_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Retired annotation identities cannot be truncated'
    USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_retirement_no_truncate';
END $$;
--> statement-breakpoint

CREATE TRIGGER ebook_annotation_retirement_no_truncate BEFORE TRUNCATE ON public.ebook_annotation_retired_ids
FOR EACH STATEMENT EXECUTE FUNCTION public.durtal_annotation_retirement_truncate_guard();
--> statement-breakpoint


CREATE FUNCTION public.durtal_annotation_retirement_consistency() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ebook_annotations a WHERE a.id = NEW.id AND (a.ebook_id <> NEW.ebook_id OR a.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'A retired id cannot have a live annotation' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_retired_not_live';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER ebook_annotation_retired_not_live AFTER INSERT ON public.ebook_annotation_retired_ids
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.durtal_annotation_retirement_consistency();
--> statement-breakpoint


CREATE FUNCTION public.durtal_annotation_lifecycle_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $$
DECLARE stamp timestamptz; digest text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.durtal_annotation_lock_book(OLD.ebook_id);
    PERFORM public.durtal_annotation_lock_id(OLD.id);
    IF OLD.deleted_at IS NULL OR OLD.deleted_at >= clock_timestamp() - interval '90 days' OR
       NOT EXISTS (SELECT 1 FROM public.ebook_annotation_retired_ids WHERE id = OLD.id AND ebook_id = OLD.ebook_id) THEN
      RAISE EXCEPTION 'Only retired tombstones older than 90 days may be purged' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_purge_guard';
    END IF;
    RETURN OLD;
  END IF;
  PERFORM public.durtal_annotation_lock_book(NEW.ebook_id);
  PERFORM public.durtal_annotation_lock_id(NEW.id);
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.ebook_id <> OLD.ebook_id OR NEW.kind <> OLD.kind OR NEW.text IS DISTINCT FROM OLD.text OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'Annotation identity and original passage are immutable' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_immutable_content';
    END IF;
    IF OLD.deleted_at IS NOT NULL THEN
      IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'A tombstone is final' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_deleted_final'; END IF;
      RETURN OLD;
    END IF;
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN OLD; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ebook_annotation_retired_ids WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'A retired UUID cannot be reused' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_retired_id';
  END IF;
  SELECT sha256 INTO digest FROM public.ebook_files WHERE id = NEW.file_id AND ebook_id = NEW.ebook_id;
  IF NOT FOUND OR (NEW.locator->>'fileHash') IS DISTINCT FROM digest THEN
    RAISE EXCEPTION 'Annotation locator does not belong to this file' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_locator_file';
  END IF;
  stamp := public.durtal_annotation_tick(NEW.ebook_id);
  IF TG_OP = 'INSERT' THEN NEW.created_at := stamp; END IF;
  NEW.updated_at := stamp;
  IF NEW.style = 'quote' THEN
    IF TG_OP = 'INSERT' THEN NEW.quote_binding_version := gen_random_uuid();
    ELSIF OLD.style <> 'quote' THEN NEW.quote_binding_version := gen_random_uuid();
    -- A changed epoch is permitted only through the internal 0087 association
    -- composition. It is never a field in a browser mutation or reanchor patch.
    END IF;
  ELSE NEW.quote_binding_version := NULL; END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_at := stamp;
    INSERT INTO public.ebook_annotation_retired_ids (id, ebook_id, retired_at) VALUES (NEW.id, NEW.ebook_id, stamp);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER ebook_annotation_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON public.ebook_annotations
FOR EACH ROW EXECUTE FUNCTION public.durtal_annotation_lifecycle_guard();
--> statement-breakpoint


-- Backfill existing tombstones before any route may purge them. No row content
-- is changed. Migration DDL locks prevent concurrent application mutation here.
INSERT INTO public.ebook_annotation_cursors (ebook_id, server_time)
  SELECT ebook_id, greatest(clock_timestamp(), max(updated_at)) FROM public.ebook_annotations
  GROUP BY ebook_id ORDER BY ebook_id ON CONFLICT (ebook_id) DO NOTHING;
--> statement-breakpoint

INSERT INTO public.ebook_annotation_retired_ids (id, ebook_id, retired_at)
  SELECT id, ebook_id, deleted_at FROM public.ebook_annotations WHERE deleted_at IS NOT NULL
  ORDER BY ebook_id, id ON CONFLICT (id) DO NOTHING;
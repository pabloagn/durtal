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

-- The following DDL is the exact proposed declaration delta, hand-written for
-- review. Generated DDL must be compared against this, not copied into history.
ALTER TABLE public.ebook_annotations
  ADD COLUMN quote_binding_version uuid,
  ALTER COLUMN client_updated_at TYPE timestamptz(6),
  ALTER COLUMN created_at TYPE timestamptz(6),
  ALTER COLUMN updated_at TYPE timestamptz(6),
  ALTER COLUMN deleted_at TYPE timestamptz(6),
  ADD CONSTRAINT ebook_annotations_note_check CHECK (note IS NULL OR char_length(note) <= 10000),
  ADD CONSTRAINT ebook_annotations_chapter_check CHECK (chapter IS NULL OR char_length(chapter) <= 300),
  ADD CONSTRAINT ebook_annotations_progression_check CHECK (progression BETWEEN 0 AND 1),
  ADD CONSTRAINT ebook_annotations_locator_check CHECK (public.durtal_annotation_locator_valid(locator)),
  ADD CONSTRAINT ebook_annotations_metadata_check CHECK (
    (kind = 'bookmark' AND style = 'highlight' AND color IS NULL AND text IS NULL AND note IS NULL AND quote_binding_version IS NULL)
    OR (kind = 'highlight' AND text IS NOT NULL AND char_length(text) BETWEEN 1 AND 10000 AND btrim(text) <> ''
      AND (locator #>> '{text,highlight}') IS NOT NULL AND btrim(locator #>> '{text,highlight}') <> ''
      AND ((style = 'quote' AND color IS NULL AND quote_binding_version IS NOT NULL)
        OR (style IN ('highlight','underline') AND color IS NOT NULL AND quote_binding_version IS NULL)))),
  ADD CONSTRAINT ebook_annotations_time_check CHECK (isfinite(client_updated_at) AND isfinite(created_at) AND isfinite(updated_at)
    AND (deleted_at IS NULL OR isfinite(deleted_at)) AND created_at <= updated_at AND (deleted_at IS NULL OR deleted_at <= updated_at));
CREATE INDEX ebook_annotations_sync_idx ON public.ebook_annotations (ebook_id, updated_at, id);
CREATE INDEX ebook_annotations_search_idx ON public.ebook_annotations USING gin
  ((public.search_normalize(coalesce(text, '') || ' ' || coalesce(note, ''))) gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE TABLE public.ebook_annotation_retired_ids (
  id uuid PRIMARY KEY,
  ebook_id uuid NOT NULL,
  retired_at timestamptz(6) NOT NULL,
  CONSTRAINT ebook_annotation_retired_ids_ebook_id_ebooks_id_fk FOREIGN KEY (ebook_id) REFERENCES public.ebooks(id) ON DELETE RESTRICT,
  CONSTRAINT ebook_annotation_retired_ids_time_check CHECK (isfinite(retired_at))
);
CREATE INDEX ebook_annotation_retired_ids_ebook_idx ON public.ebook_annotation_retired_ids (ebook_id);
CREATE TABLE public.ebook_annotation_cursors (
  ebook_id uuid PRIMARY KEY,
  server_time timestamptz(6) NOT NULL,
  CONSTRAINT ebook_annotation_cursors_ebook_id_ebooks_id_fk FOREIGN KEY (ebook_id) REFERENCES public.ebooks(id) ON DELETE CASCADE,
  CONSTRAINT ebook_annotation_cursors_time_check CHECK (isfinite(server_time))
);

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

CREATE FUNCTION public.durtal_annotation_lock_id(p_id uuid) RETURNS void
LANGUAGE sql VOLATILE SET search_path = pg_catalog, public AS $$
  SELECT pg_advisory_xact_lock(hashtextextended(p_id::text, 500));
$$;

CREATE FUNCTION public.durtal_annotation_tick(p_ebook_id uuid) RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public AS $$
DECLARE stamp timestamptz;
BEGIN
  PERFORM public.durtal_annotation_lock_book(p_ebook_id);
  UPDATE public.ebook_annotation_cursors SET server_time = greatest(clock_timestamp(), server_time + interval '1 microsecond')
    WHERE ebook_id = p_ebook_id RETURNING server_time INTO stamp;
  RETURN stamp;
END $$;

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
CREATE TRIGGER ebook_annotation_cursor_monotonic BEFORE UPDATE OR DELETE ON public.ebook_annotation_cursors
FOR EACH ROW EXECUTE FUNCTION public.durtal_annotation_cursor_guard();

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
CREATE TRIGGER ebook_annotation_retirement_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.ebook_annotation_retired_ids
FOR EACH ROW EXECUTE FUNCTION public.durtal_annotation_retirement_guard();

CREATE FUNCTION public.durtal_annotation_retirement_consistency() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ebook_annotations a WHERE a.id = NEW.id AND (a.ebook_id <> NEW.ebook_id OR a.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'A retired id cannot have a live annotation' USING ERRCODE = '23514', CONSTRAINT = 'ebook_annotation_retired_not_live';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ebook_annotation_retired_not_live AFTER INSERT ON public.ebook_annotation_retired_ids
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.durtal_annotation_retirement_consistency();

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
CREATE TRIGGER ebook_annotation_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON public.ebook_annotations
FOR EACH ROW EXECUTE FUNCTION public.durtal_annotation_lifecycle_guard();

-- Backfill existing tombstones before any route may purge them. No row content
-- is changed. Migration DDL locks prevent concurrent application mutation here.
INSERT INTO public.ebook_annotation_cursors (ebook_id, server_time)
  SELECT ebook_id, greatest(clock_timestamp(), max(updated_at)) FROM public.ebook_annotations
  GROUP BY ebook_id ORDER BY ebook_id ON CONFLICT (ebook_id) DO NOTHING;
INSERT INTO public.ebook_annotation_retired_ids (id, ebook_id, retired_at)
  SELECT id, ebook_id, deleted_at FROM public.ebook_annotations WHERE deleted_at IS NOT NULL
  ORDER BY ebook_id, id ON CONFLICT (id) DO NOTHING;

-- Review/rehearsal preflight:
-- Do not invent a note binding epoch for an existing live quote: reconcile its
-- real tracker association first, or refuse migration; never downgrade silently.
-- Existing integration bookmark fixtures use incomplete legacy locators and
-- must be updated to complete DurtalLocators before the full zero-skip run.

-- Server source obligations (not represented as a PostgreSQL security boundary):
-- public browser puts whitelist highlight/underline and cannot modify an
-- existing quote; note and CAS reanchor patches preserve privilege/content.
-- A server-only planHighlight/createHighlight module is the only quote insert
-- path; no 'use server' export and no browser-controlled privileged flag/GUC.
-- Direct SQL credentials/schema ownership are trusted. No SET LOCAL bypass is
-- used or claimed to defend against the database owner.
-- READ: one atomic batch ticks/locks this book, then reads rows <= captured upper
-- cursor. Include since >= lower; reset at serverTime-since >= 90 days and return
-- all live rows. Writers/purge cannot pass this lock until that batch commits.
-- POST: exact per-item predicates live+owner+newer client time, or reanchor CAS
-- expected file+client time, are repeated in SQL under the same lock. Equal/old
-- writes have no UPDATE and no timestamp churn. A no-op POST timestamp never
-- advances a browser's pull cursor. Purge only this book's aged full tombstones.
-- Absent-id delete: tick under book/id locks then INSERT the minimal retirement;
-- do not create a fabricated full annotation row or remove its retirement later.
-- Deferred quote composition draft is the adjacent review-only SQL file; it is
-- gated on 0087's actual reading_notes.ebook_annotation_id and ownership guard.

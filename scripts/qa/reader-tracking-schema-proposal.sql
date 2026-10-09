-- SLN-454: exact review input for reserved 0087_reader_tracker_integration.
-- NOT a migration, NOT executed. Generate the Drizzle portion on approved main
-- only after root review, then append reviewed custom SQL to that NEW migration.
-- No alteration of applied 0075/0076 and no historical data synthesis/backfill.

CREATE TABLE legacy_reader_progress (
  ebook_id uuid PRIMARY KEY REFERENCES ebooks(id) ON DELETE RESTRICT,
  progress_fraction real,
  started_at timestamptz, last_read_at timestamptz, finished_at timestamptz,
  preserved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_reader_progress_fraction_check CHECK
    (progress_fraction IS NULL OR progress_fraction BETWEEN 0 AND 1),
  CONSTRAINT legacy_reader_progress_dates_check CHECK
    ((started_at IS NULL OR isfinite(started_at))
     AND (last_read_at IS NULL OR isfinite(last_read_at))
     AND (finished_at IS NULL OR isfinite(finished_at)))
);
-- Populate separately ONLY from an actual reviewed recovery input or synthetic
-- disposable fixture. Historical dates deliberately have no DEFAULT.

CREATE TABLE reader_sitting_receipts (
  sitting_id uuid PRIMARY KEY,
  reading_id uuid NOT NULL, ebook_id uuid NOT NULL, device_id uuid NOT NULL,
  original_session_id uuid NOT NULL,
  session_id uuid REFERENCES reading_sessions(id) ON DELETE SET NULL,
  revision integer NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL,
  active_seconds integer NOT NULL,
  start_percent numeric(5,2) NOT NULL, end_percent numeric(5,2) NOT NULL,
  end_chapter text, time_zone text NOT NULL, going_back boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'active', retired_at timestamptz, retire_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reader_sitting_receipt_values_check CHECK
    (revision BETWEEN 1 AND 2147483647 AND isfinite(started_at) AND isfinite(ended_at)
     AND ended_at >= started_at AND active_seconds BETWEEN 1 AND 86400
     AND active_seconds <= floor(extract(epoch FROM (ended_at - started_at)))
     AND start_percent BETWEEN 0 AND 100 AND end_percent BETWEEN 0 AND 100
     AND (end_chapter IS NULL OR char_length(end_chapter) <= 300)
     AND char_length(time_zone) BETWEEN 1 AND 100),
  CONSTRAINT reader_sitting_receipt_retirement_check CHECK
    ((state = 'active' AND session_id IS NOT NULL AND retired_at IS NULL AND retire_reason IS NULL)
     OR (state = 'retired' AND session_id IS NULL AND retired_at IS NOT NULL AND isfinite(retired_at) AND retire_reason IS NOT NULL
       AND retire_reason IN ('session_deleted','session_edited','reading_deleted','reading_closed',
         'reading_edited','binding_changed','book_merged','compensated','session_missing')))
);
CREATE INDEX reader_sitting_receipt_session_idx ON reader_sitting_receipts(session_id);
CREATE INDEX reader_sitting_receipt_reading_idx ON reader_sitting_receipts(reading_id);
CREATE INDEX reader_sitting_receipt_ebook_idx ON reader_sitting_receipts(ebook_id);
ALTER TABLE app_settings ADD COLUMN reading_auto_track_ebooks boolean NOT NULL DEFAULT true;
ALTER TABLE reading_notes ADD COLUMN ebook_annotation_id uuid;
ALTER TABLE reading_notes ADD CONSTRAINT reading_notes_ebook_annotation_id_unique UNIQUE(ebook_annotation_id);
ALTER TABLE reading_notes ADD CONSTRAINT reading_notes_ebook_annotation_id_ebook_annotations_id_fk
  FOREIGN KEY (ebook_annotation_id) REFERENCES ebook_annotations(id) ON DELETE SET NULL;

-- Permanent identities are not a merge reference: none of reading_id, ebook_id,
-- original_session_id has a cascading FK, and no merge rewrites them.
CREATE FUNCTION guard_reader_sitting_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Reader sitting receipts are permanent' USING ERRCODE='23514', CONSTRAINT='reader_sitting_receipt_permanent';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.sitting_id,NEW.reading_id,NEW.ebook_id,NEW.device_id,NEW.original_session_id,
        NEW.started_at,NEW.start_percent,NEW.time_zone,NEW.going_back)
      IS DISTINCT FROM
       (OLD.sitting_id,OLD.reading_id,OLD.ebook_id,OLD.device_id,OLD.original_session_id,
        OLD.started_at,OLD.start_percent,OLD.time_zone,OLD.going_back) THEN
      RAISE EXCEPTION 'Reader sitting identity changed' USING ERRCODE='23514', CONSTRAINT='reader_sitting_receipt_identity';
    END IF;
    IF OLD.state = 'retired' THEN
      IF NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'A retired reader sitting cannot change' USING ERRCODE='23514', CONSTRAINT='reader_sitting_receipt_retired';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id THEN
      RAISE EXCEPTION 'Reader sitting session changed' USING ERRCODE='23514', CONSTRAINT='reader_sitting_receipt_identity';
    END IF;
    -- Includes the FK's SET NULL update. Retire BEFORE the active CHECK runs.
    IF NEW.session_id IS NULL THEN
      NEW.state := 'retired';
      NEW.retired_at := coalesce(NEW.retired_at, clock_timestamp());
      NEW.retire_reason := coalesce(NEW.retire_reason,
        CASE WHEN EXISTS (SELECT 1 FROM reading_sessions WHERE id=OLD.session_id)
          THEN 'compensated' ELSE 'session_deleted' END);
    END IF;
    IF NEW.state = 'retired' THEN
      IF (NEW.revision,NEW.ended_at,NEW.active_seconds,NEW.end_percent,NEW.end_chapter)
        IS DISTINCT FROM (OLD.revision,OLD.ended_at,OLD.active_seconds,OLD.end_percent,OLD.end_chapter) THEN
        RAISE EXCEPTION 'Retirement must preserve the last receipt' USING ERRCODE='23514', CONSTRAINT='reader_sitting_receipt_revision';
      END IF;
      NEW.updated_at := clock_timestamp();
      RETURN NEW;
    END IF;
    IF NEW.revision < OLD.revision OR NEW.active_seconds < OLD.active_seconds OR NEW.ended_at < OLD.ended_at
       OR (NEW.revision=OLD.revision AND
         (NEW.ended_at,NEW.active_seconds,NEW.end_percent,NEW.end_chapter)
         IS DISTINCT FROM (OLD.ended_at,OLD.active_seconds,OLD.end_percent,OLD.end_chapter)) THEN
      RAISE EXCEPTION 'Reader sitting revision changed or regressed' USING ERRCODE='23514', CONSTRAINT='reader_sitting_receipt_revision';
    END IF;
  ELSE
    IF NEW.state <> 'active' OR NEW.session_id IS DISTINCT FROM NEW.original_session_id THEN
      RAISE EXCEPTION 'New reader sitting requires its original session' USING ERRCODE='23514', CONSTRAINT='reader_sitting_receipt_identity';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=NEW.time_zone) THEN
    RAISE EXCEPTION 'Invalid reader sitting time zone' USING ERRCODE='23514', CONSTRAINT='reader_sitting_receipt_time_zone';
  END IF;
  -- FOR SHARE protects the non-key binding/status columns through commit.
  PERFORM 1 FROM reading_sessions s JOIN readings r ON r.id=s.reading_id
    JOIN ebooks eb ON eb.id=NEW.ebook_id JOIN instances i ON i.id=eb.instance_id
    JOIN editions e ON e.id=i.edition_id JOIN works w ON w.id=e.work_id
    WHERE s.id=NEW.session_id AND r.id=NEW.reading_id AND r.work_id=e.work_id
      AND r.status IN ('reading','paused') AND eb.match_state='linked' AND w.kind='book'
      AND s.source='reader' AND s.format='ebook' AND s.edition_id=i.edition_id
    FOR SHARE OF s,r,eb,i,e,w;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reader sitting binding changed' USING ERRCODE='23514', CONSTRAINT='reader_sitting_receipt_binding';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER reader_sitting_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON reader_sitting_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_reader_sitting_receipt();
CREATE TRIGGER reader_sitting_receipt_no_truncate BEFORE TRUNCATE ON reader_sitting_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION guard_reader_sitting_receipt();

-- A tracker batch writes its receipt before extending the canonical session,
-- sets this transaction-local token to that session UUID, and clears it before
-- unrelated work. The token ALONE grants nothing: the live receipt must also
-- have been written in this PostgreSQL transaction. This is an internal write
-- protocol, not a security boundary against a privileged SQL owner.
CREATE FUNCTION reader_tracking_session_proof(wanted_session uuid, wanted_reading uuid)
RETURNS boolean LANGUAGE sql VOLATILE AS $$
  SELECT current_setting('durtal.reader_tracking_session',true)=wanted_session::text
    AND EXISTS (SELECT 1 FROM reader_sitting_receipts c
      WHERE c.session_id=wanted_session AND c.reading_id=wanted_reading AND c.state='active'
        AND c.xmin=pg_current_xact_id()::text::xid)
$$;

-- Check CURRENT rows at commit, not the queued NEW snapshot of an earlier
-- revision. Canonical updates and their cumulative receipt must agree atomically.
CREATE FUNCTION check_reader_sitting_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid uuid; s reading_sessions%ROWTYPE; last_c reader_sitting_receipts%ROWTYPE;
        first_at timestamptz; last_at timestamptz; total bigint;
BEGIN
  SELECT session_id INTO sid FROM reader_sitting_receipts WHERE sitting_id=NEW.sitting_id AND state='active';
  IF sid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM reading_sessions WHERE id=sid;
  SELECT min(started_at), max(ended_at), sum(active_seconds) INTO first_at,last_at,total
    FROM reader_sitting_receipts WHERE session_id=sid AND state='active';
  SELECT * INTO last_c FROM reader_sitting_receipts WHERE session_id=sid AND state='active'
    ORDER BY started_at DESC, sitting_id DESC LIMIT 1;
  IF s.id IS NULL OR s.source<>'reader' OR s.format<>'ebook'
     OR s.started_at IS DISTINCT FROM first_at OR s.ended_at IS DISTINCT FROM last_at
     OR s.duration_seconds IS DISTINCT FROM total
     OR s.end_percent IS DISTINCT FROM last_c.end_percent OR s.end_chapter IS DISTINCT FROM last_c.end_chapter
     OR EXISTS (SELECT 1 FROM reader_sitting_receipts c WHERE c.session_id=sid AND c.state='active'
       AND (c.reading_id<>s.reading_id OR c.ebook_id<>last_c.ebook_id))
     OR EXISTS (SELECT 1 FROM reader_sitting_receipts a JOIN reader_sitting_receipts b
       ON a.session_id=b.session_id AND a.sitting_id<b.sitting_id
       WHERE a.session_id=sid AND a.state='active' AND b.state='active'
         AND a.started_at<b.ended_at AND b.started_at<a.ended_at) THEN
    RAISE EXCEPTION 'Reader sitting and session disagree' USING ERRCODE='23514', CONSTRAINT='reader_sitting_receipt_session';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER reader_sitting_receipt_session_check AFTER INSERT OR UPDATE ON reader_sitting_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_sitting_session();

CREATE FUNCTION retire_reader_session_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    -- Existing shared startUpdates only changes these derived starts. A manual
    -- reading-start edit is retired by the separate reading guard first.
    IF (to_jsonb(NEW)-ARRAY['start_page','start_percent','start_minutes','updated_at','pages_read'])
       IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['start_page','start_percent','start_minutes','updated_at','pages_read']) THEN
      RETURN NEW;
    END IF;
    IF reader_tracking_session_proof(OLD.id,OLD.reading_id)
       AND (to_jsonb(NEW)-ARRAY['start_page','start_percent','start_minutes','end_page','end_percent',
         'end_minutes','end_chapter','ended_at','duration_seconds','updated_at','pages_read'])
       IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['start_page','start_percent','start_minutes','end_page','end_percent',
         'end_minutes','end_chapter','ended_at','duration_seconds','updated_at','pages_read']) THEN
      RETURN NEW;
    END IF;
  END IF;
  UPDATE reader_sitting_receipts SET state='retired',session_id=NULL,
    retired_at=clock_timestamp(),retire_reason=CASE WHEN TG_OP='DELETE' THEN 'session_deleted' ELSE 'session_edited' END
    WHERE session_id=OLD.id AND state='active';
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reader_session_receipts_retire BEFORE UPDATE OR DELETE ON reading_sessions
  FOR EACH ROW EXECUTE FUNCTION retire_reader_session_receipts();

CREATE FUNCTION retire_reader_reading_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reason text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN RETURN NEW; END IF;
    IF NEW.work_id IS NOT DISTINCT FROM OLD.work_id
      AND (to_jsonb(NEW)-ARRAY['current_page','current_percent','current_minutes','current_chapter','last_read_at','status','updated_at'])
        IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['current_page','current_percent','current_minutes','current_chapter','last_read_at','status','updated_at'])
      AND NEW.status='reading'
      AND EXISTS (SELECT 1 FROM reader_sitting_receipts c WHERE c.reading_id=OLD.id AND c.state='active'
        AND reader_tracking_session_proof(c.session_id,OLD.id)) THEN RETURN NEW; END IF;
    reason := CASE WHEN NEW.work_id IS DISTINCT FROM OLD.work_id
        AND harmonization_allows_move('works',OLD.work_id,NEW.work_id) THEN 'book_merged'
      WHEN NEW.status IN ('finished','abandoned') THEN 'reading_closed'
      WHEN (NEW.edition_id,NEW.instance_id,NEW.format) IS DISTINCT FROM (OLD.edition_id,OLD.instance_id,OLD.format)
        THEN 'binding_changed' ELSE 'reading_edited' END;
  ELSE reason := 'reading_deleted'; END IF;
  UPDATE reader_sitting_receipts SET state='retired',session_id=NULL,retired_at=clock_timestamp(),retire_reason=reason
    WHERE reading_id=OLD.id AND state='active';
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reader_reading_receipts_retire BEFORE UPDATE OR DELETE ON readings
  FOR EACH ROW EXECUTE FUNCTION retire_reader_reading_receipts();

-- Binding changes can occur without an explicit update of the reading/session.
CREATE FUNCTION retire_reader_binding_receipts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='ebooks' THEN
    IF TG_OP='UPDATE' AND (NEW.instance_id,NEW.match_state) IS NOT DISTINCT FROM (OLD.instance_id,OLD.match_state) THEN RETURN NEW; END IF;
    UPDATE reader_sitting_receipts SET state='retired',session_id=NULL,retired_at=clock_timestamp(),retire_reason='binding_changed'
      WHERE ebook_id=OLD.id AND state='active';
  ELSIF TG_TABLE_NAME='instances' THEN
    IF TG_OP='UPDATE' AND NEW.edition_id IS NOT DISTINCT FROM OLD.edition_id THEN RETURN NEW; END IF;
    UPDATE reader_sitting_receipts SET state='retired',session_id=NULL,retired_at=clock_timestamp(),retire_reason='binding_changed'
      WHERE state='active' AND ebook_id IN (SELECT id FROM ebooks WHERE instance_id=OLD.id);
  ELSIF TG_TABLE_NAME='editions' THEN
    IF TG_OP='UPDATE' AND NEW.work_id IS NOT DISTINCT FROM OLD.work_id THEN RETURN NEW; END IF;
    UPDATE reader_sitting_receipts SET state='retired',session_id=NULL,retired_at=clock_timestamp(),retire_reason='binding_changed'
      WHERE state='active' AND ebook_id IN (SELECT eb.id FROM ebooks eb JOIN instances i ON i.id=eb.instance_id WHERE i.edition_id=OLD.id);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reader_ebook_receipts_retire BEFORE UPDATE OR DELETE ON ebooks FOR EACH ROW EXECUTE FUNCTION retire_reader_binding_receipts();
CREATE TRIGGER reader_instance_receipts_retire BEFORE UPDATE OR DELETE ON instances FOR EACH ROW EXECUTE FUNCTION retire_reader_binding_receipts();
CREATE TRIGGER reader_edition_receipts_retire BEFORE UPDATE OR DELETE ON editions FOR EACH ROW EXECUTE FUNCTION retire_reader_binding_receipts();

-- Concrete SLN-500 dependency: reviewed 0083 supplies quote_binding_version,
-- durtal_annotation_lock_book/lock_id, lifecycle cursor and retired IDs.
-- These shared locks are acquired before validating any note/book association.
CREATE FUNCTION public.durtal_reader_lock_quote_ebooks(p_ebook_ids uuid[]) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT DISTINCT unnest(p_ebook_ids) ORDER BY 1 LOOP
    PERFORM public.durtal_annotation_lock_book(v_id);
  END LOOP;
  FOR v_id IN SELECT a.id FROM public.ebook_annotations a WHERE a.ebook_id=ANY(p_ebook_ids) ORDER BY a.id LOOP
    PERFORM public.durtal_annotation_lock_id(v_id);
  END LOOP;
  PERFORM 1 FROM public.reading_notes n JOIN public.ebook_annotations a ON a.id=n.ebook_annotation_id
    WHERE a.ebook_id=ANY(p_ebook_ids) ORDER BY n.id FOR UPDATE OF n;
END $$;

CREATE FUNCTION public.durtal_reader_lock_quote_notes(p_note_ids uuid[], p_annotation_ids uuid[] DEFAULT '{}'::uuid[])
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public AS $$
DECLARE ids uuid[]; books uuid[]; v_id uuid;
BEGIN
  SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO ids FROM
    (SELECT DISTINCT unnest(p_annotation_ids) AS id UNION
     SELECT ebook_annotation_id FROM public.reading_notes WHERE id=ANY(p_note_ids) AND ebook_annotation_id IS NOT NULL) chosen WHERE chosen.id IS NOT NULL;
  SELECT coalesce(array_agg(DISTINCT ebook_id ORDER BY ebook_id),'{}'::uuid[]) INTO books
    FROM public.ebook_annotations WHERE id=ANY(ids);
  FOR v_id IN SELECT unnest(books) LOOP PERFORM public.durtal_annotation_lock_book(v_id); END LOOP;
  FOR v_id IN SELECT unnest(ids) LOOP PERFORM public.durtal_annotation_lock_id(v_id); END LOOP;
  PERFORM 1 FROM public.reading_notes WHERE id=ANY(p_note_ids) ORDER BY id FOR UPDATE;
  -- A note may have changed association while initial discovery was unlocked.
  -- Roll back and replan; never obtain a new lower-order lock after note locks.
  IF EXISTS (SELECT 1 FROM public.reading_notes n WHERE n.id=ANY(p_note_ids)
      AND n.ebook_annotation_id IS NOT NULL AND NOT(n.ebook_annotation_id=ANY(ids))) THEN
    RAISE EXCEPTION 'Quote association changed; retry' USING ERRCODE='40001';
  END IF;
END $$;

CREATE FUNCTION public.durtal_reader_stamp_note_version() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.ebook_annotation_id IS NOT NULL THEN
      IF NOT isfinite(NEW.updated_at) THEN
        RAISE EXCEPTION 'Quote version must be finite' USING ERRCODE='23514', CONSTRAINT='reading_note_version_finite';
      END IF;
      NEW.updated_at := greatest(clock_timestamp(),NEW.updated_at+interval '1 microsecond');
    END IF;
  ELSIF NEW.ebook_annotation_id IS NOT NULL OR OLD.ebook_annotation_id IS NOT NULL
      OR NEW.updated_at IS DISTINCT FROM OLD.updated_at
      OR (to_jsonb(NEW)-ARRAY['reading_id','edition_id','import_id','updated_at','search_text'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['reading_id','edition_id','import_id','updated_at','search_text']) THEN
    IF NOT isfinite(OLD.updated_at) THEN
      RAISE EXCEPTION 'Note version must be finite' USING ERRCODE='23514', CONSTRAINT='reading_note_version_finite';
    END IF;
    NEW.updated_at := greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reading_note_version_stamp BEFORE INSERT OR UPDATE ON public.reading_notes
  FOR EACH ROW EXECUTE FUNCTION public.durtal_reader_stamp_note_version();

CREATE FUNCTION public.durtal_reader_rotate_note_quote_epoch() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public AS $$
DECLARE ids uuid[];
BEGIN
  IF TG_OP='UPDATE' AND (NEW.id,NEW.work_id,NEW.reading_id,NEW.edition_id,NEW.ebook_annotation_id)
    IS NOT DISTINCT FROM (OLD.id,OLD.work_id,OLD.reading_id,OLD.edition_id,OLD.ebook_annotation_id) THEN RETURN NULL; END IF;
  IF TG_OP='INSERT' THEN ids:=ARRAY[NEW.ebook_annotation_id];
  ELSIF TG_OP='DELETE' THEN ids:=ARRAY[OLD.ebook_annotation_id];
  ELSE ids:=ARRAY[OLD.ebook_annotation_id,NEW.ebook_annotation_id]; END IF;
  -- 0083 lifecycle stamps the cursor; only server-issued epoch changes.
  -- Tombstones/retired IDs remain final. A kept quote on a retired mark is an
  -- ordinary note and must never recreate or convert that mark on deletion.
  UPDATE public.ebook_annotations a SET quote_binding_version=gen_random_uuid()
    WHERE a.id=ANY(ids) AND a.style='quote' AND a.deleted_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.ebook_annotation_retired_ids r WHERE r.id=a.id);
  RETURN NULL;
END $$;
CREATE TRIGGER reading_note_quote_epoch AFTER INSERT OR UPDATE OR DELETE ON public.reading_notes
  FOR EACH ROW EXECUTE FUNCTION public.durtal_reader_rotate_note_quote_epoch();

CREATE FUNCTION public.durtal_reader_lock_and_rotate_binding() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public AS $$
DECLARE books uuid[];
BEGIN
  IF TG_TABLE_NAME='ebooks' THEN
    IF TG_OP='UPDATE' AND (NEW.instance_id,NEW.match_state) IS NOT DISTINCT FROM (OLD.instance_id,OLD.match_state) THEN RETURN NEW; END IF;
    books:=ARRAY[OLD.id];
  ELSIF TG_TABLE_NAME='instances' THEN
    IF TG_OP='UPDATE' AND NEW.edition_id IS NOT DISTINCT FROM OLD.edition_id THEN RETURN NEW; END IF;
    SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO books FROM public.ebooks WHERE instance_id=OLD.id;
  ELSIF TG_TABLE_NAME='editions' THEN
    IF TG_OP='UPDATE' AND NEW.work_id IS NOT DISTINCT FROM OLD.work_id THEN RETURN NEW; END IF;
    SELECT coalesce(array_agg(eb.id ORDER BY eb.id),'{}'::uuid[]) INTO books FROM public.ebooks eb
      JOIN public.instances i ON i.id=eb.instance_id WHERE i.edition_id=OLD.id;
  END IF;
  PERFORM public.durtal_reader_lock_quote_ebooks(books);
  UPDATE public.ebook_annotations a SET quote_binding_version=gen_random_uuid()
    WHERE a.ebook_id=ANY(books) AND a.style='quote' AND a.deleted_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.ebook_annotation_retired_ids r WHERE r.id=a.id);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reader_quote_binding_ebook_lock BEFORE UPDATE OR DELETE ON public.ebooks
  FOR EACH ROW EXECUTE FUNCTION public.durtal_reader_lock_and_rotate_binding();
CREATE TRIGGER reader_quote_binding_instance_lock BEFORE UPDATE OR DELETE ON public.instances
  FOR EACH ROW EXECUTE FUNCTION public.durtal_reader_lock_and_rotate_binding();
CREATE TRIGGER reader_quote_binding_edition_lock BEFORE UPDATE OR DELETE ON public.editions
  FOR EACH ROW EXECUTE FUNCTION public.durtal_reader_lock_and_rotate_binding();


-- Preserve migration 0069's audited merge pass-through and both reference
-- guards. Clear references remain allowed, including annotation FK SET NULL.
CREATE OR REPLACE FUNCTION guard_reading_note() RETURNS trigger LANGUAGE plpgsql VOLATILE
SET search_path=pg_catalog,public AS $$
DECLARE note_ids uuid[]; annotation_ids uuid[];
BEGIN
  IF TG_OP='INSERT' THEN note_ids:=ARRAY[NEW.id]; annotation_ids:=ARRAY[NEW.ebook_annotation_id];
  ELSIF TG_OP='DELETE' THEN note_ids:=ARRAY[OLD.id]; annotation_ids:=ARRAY[OLD.ebook_annotation_id];
  ELSE note_ids:=ARRAY[OLD.id]; annotation_ids:=ARRAY[OLD.ebook_annotation_id,NEW.ebook_annotation_id]; END IF;
  PERFORM public.durtal_reader_lock_quote_notes(note_ids,annotation_ids);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  -- Ownership below is re-read after all lock waits, even on content-only writes.
  -- The original audited merge exemption follows locking, never precedes it.
  IF TG_OP='UPDATE' AND NEW.work_id IS DISTINCT FROM OLD.work_id
     AND NEW.reading_id IS NOT DISTINCT FROM OLD.reading_id
     AND harmonization_allows_move('works',OLD.work_id,NEW.work_id) THEN RETURN NEW; END IF;
  IF NEW.edition_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.edition_id IS DISTINCT FROM OLD.edition_id OR NEW.work_id IS DISTINCT FROM OLD.work_id) THEN
    IF NOT EXISTS (SELECT 1 FROM editions e WHERE e.id=NEW.edition_id AND e.work_id=NEW.work_id) THEN
      RAISE EXCEPTION 'This edition belongs to another book' USING ERRCODE='23514', CONSTRAINT='reading_note_edition_work';
    END IF;
  END IF;
  IF NEW.reading_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.reading_id IS DISTINCT FROM OLD.reading_id OR NEW.work_id IS DISTINCT FROM OLD.work_id) THEN
    IF NOT EXISTS (SELECT 1 FROM readings r WHERE r.id=NEW.reading_id AND r.work_id=NEW.work_id) THEN
      RAISE EXCEPTION 'This reading belongs to another book' USING ERRCODE='23514', CONSTRAINT='reading_note_reading_work';
    END IF;
  END IF;
  IF NEW.ebook_annotation_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM ebook_annotations a JOIN ebooks eb ON eb.id=a.ebook_id
      JOIN instances i ON i.id=eb.instance_id JOIN editions e ON e.id=i.edition_id
      WHERE a.id=NEW.ebook_annotation_id AND eb.match_state='linked' AND e.work_id=NEW.work_id) THEN
      RAISE EXCEPTION 'This eBook belongs to another book' USING ERRCODE='23514', CONSTRAINT='reading_note_ebook_work';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER reading_note_guard ON reading_notes;
CREATE TRIGGER reading_note_guard BEFORE INSERT OR UPDATE OR DELETE ON reading_notes
  FOR EACH ROW EXECUTE FUNCTION guard_reading_note();

-- The audited merge may temporarily move notes before readings/copies. Check
-- final annotation/book ownership after all composed queries; relink must
-- clear an old quote's link atomically if it keeps that quote on its old book.
CREATE FUNCTION check_reader_quote_binding() RETURNS trigger LANGUAGE plpgsql VOLATILE
SET search_path=pg_catalog,public AS $$
DECLARE books uuid[]; v_id uuid;
BEGIN
  -- A deferred check is not the lock protocol. Guard triggers already hold the
  -- same binding locks; repeat acquisition here before the fresh final query.
  SELECT coalesce(array_agg(DISTINCT a.ebook_id ORDER BY a.ebook_id),'{}'::uuid[]) INTO books
    FROM public.reading_notes n JOIN public.ebook_annotations a ON a.id=n.ebook_annotation_id
    JOIN public.ebooks eb ON eb.id=a.ebook_id
    LEFT JOIN public.instances i ON i.id=eb.instance_id LEFT JOIN public.editions e ON e.id=i.edition_id
    WHERE CASE TG_TABLE_NAME WHEN 'reading_notes' THEN n.id=NEW.id
      WHEN 'ebooks' THEN eb.id=NEW.id WHEN 'instances' THEN i.id=NEW.id
      WHEN 'editions' THEN e.id=NEW.id WHEN 'ebook_annotations' THEN a.id=NEW.id END;
  -- No extra note-row locks here: catalogue writers already hold them. Locking
  -- unrelated notes at commit would invert a concurrent note writer's row lock.
  FOR v_id IN SELECT unnest(books) LOOP PERFORM public.durtal_annotation_lock_book(v_id); END LOOP;
  FOR v_id IN SELECT a.id FROM public.reading_notes n JOIN public.ebook_annotations a ON a.id=n.ebook_annotation_id
    JOIN public.ebooks eb ON eb.id=a.ebook_id
    LEFT JOIN public.instances i ON i.id=eb.instance_id LEFT JOIN public.editions e ON e.id=i.edition_id
    WHERE CASE TG_TABLE_NAME WHEN 'reading_notes' THEN n.id=NEW.id
      WHEN 'ebooks' THEN eb.id=NEW.id WHEN 'instances' THEN i.id=NEW.id
      WHEN 'editions' THEN e.id=NEW.id WHEN 'ebook_annotations' THEN a.id=NEW.id END
    ORDER BY a.id LOOP PERFORM public.durtal_annotation_lock_id(v_id); END LOOP;
  IF EXISTS (SELECT 1 FROM reading_notes n JOIN ebook_annotations a ON a.id=n.ebook_annotation_id
    LEFT JOIN ebooks eb ON eb.id=a.ebook_id LEFT JOIN instances i ON i.id=eb.instance_id
    LEFT JOIN editions e ON e.id=i.edition_id
    WHERE CASE TG_TABLE_NAME WHEN 'reading_notes' THEN n.id=NEW.id
      WHEN 'ebooks' THEN eb.id=NEW.id WHEN 'instances' THEN i.id=NEW.id
      WHEN 'editions' THEN e.id=NEW.id WHEN 'ebook_annotations' THEN a.id=NEW.id END
      AND (eb.match_state IS DISTINCT FROM 'linked' OR e.work_id IS DISTINCT FROM n.work_id)) THEN
    RAISE EXCEPTION 'This eBook belongs to another book' USING ERRCODE='23514', CONSTRAINT='reading_note_ebook_work';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER reader_quote_note_binding_check AFTER INSERT OR UPDATE ON reading_notes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_quote_binding();
CREATE CONSTRAINT TRIGGER reader_quote_ebook_binding_check AFTER UPDATE ON ebooks
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_quote_binding();
CREATE CONSTRAINT TRIGGER reader_quote_instance_binding_check AFTER UPDATE ON instances
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_quote_binding();
CREATE CONSTRAINT TRIGGER reader_quote_edition_binding_check AFTER UPDATE ON editions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_quote_binding();
CREATE CONSTRAINT TRIGGER reader_quote_annotation_binding_check AFTER UPDATE ON ebook_annotations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_quote_binding();

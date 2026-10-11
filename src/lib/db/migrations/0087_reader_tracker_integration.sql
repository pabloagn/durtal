CREATE TABLE "legacy_reader_progress" (
	"ebook_id" uuid PRIMARY KEY NOT NULL,
	"progress_fraction" real,
	"started_at" timestamp with time zone,
	"last_read_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"preserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_reader_progress_fraction_check" CHECK ("legacy_reader_progress"."progress_fraction" is null or "legacy_reader_progress"."progress_fraction" between 0 and 1),
	CONSTRAINT "legacy_reader_progress_dates_check" CHECK (
    ("legacy_reader_progress"."started_at" is null or isfinite("legacy_reader_progress"."started_at"))
    and ("legacy_reader_progress"."last_read_at" is null or isfinite("legacy_reader_progress"."last_read_at"))
    and ("legacy_reader_progress"."finished_at" is null or isfinite("legacy_reader_progress"."finished_at")))
);
--> statement-breakpoint
CREATE TABLE "reader_quote_undo_receipts" (
	"token" uuid PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL,
	"ebook_id" uuid NOT NULL,
	"annotation_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"note_snapshot" jsonb NOT NULL,
	"annotation_fingerprint" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "reader_quote_undo_evidence_check" CHECK (coalesce(jsonb_typeof("reader_quote_undo_receipts"."note_snapshot")='object'
    and ("reader_quote_undo_receipts"."note_snapshot"->>'id')::uuid="reader_quote_undo_receipts"."note_id"
    and ("reader_quote_undo_receipts"."note_snapshot"->>'work_id')::uuid="reader_quote_undo_receipts"."work_id"
    and ("reader_quote_undo_receipts"."note_snapshot"->>'ebook_annotation_id')::uuid="reader_quote_undo_receipts"."annotation_id"
    and "reader_quote_undo_receipts"."note_snapshot"->>'kind'='quote'
    and "reader_quote_undo_receipts"."annotation_fingerprint" ~ '^[a-f0-9]{32}$'
    and isfinite("reader_quote_undo_receipts"."expires_at") and ("reader_quote_undo_receipts"."used_at" is null or isfinite("reader_quote_undo_receipts"."used_at")),false))
);
--> statement-breakpoint
CREATE TABLE "reader_sitting_receipts" (
	"sitting_id" uuid PRIMARY KEY NOT NULL,
	"reading_id" uuid NOT NULL,
	"ebook_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"original_session_id" uuid NOT NULL,
	"session_id" uuid,
	"revision" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"active_seconds" integer NOT NULL,
	"start_percent" numeric(5, 2) NOT NULL,
	"end_percent" numeric(5, 2) NOT NULL,
	"end_chapter" text,
	"time_zone" text NOT NULL,
	"going_back" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"retired_at" timestamp with time zone,
	"retire_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reader_sitting_receipt_values_check" CHECK (
    "reader_sitting_receipts"."revision" between 1 and 2147483647
    and isfinite("reader_sitting_receipts"."started_at") and isfinite("reader_sitting_receipts"."ended_at")
    and "reader_sitting_receipts"."ended_at" >= "reader_sitting_receipts"."started_at"
    and "reader_sitting_receipts"."active_seconds" between 1 and 86400
    and "reader_sitting_receipts"."active_seconds" <= floor(extract(epoch from ("reader_sitting_receipts"."ended_at" - "reader_sitting_receipts"."started_at")))
    and "reader_sitting_receipts"."start_percent" between 0 and 100 and "reader_sitting_receipts"."end_percent" between 0 and 100
    and ("reader_sitting_receipts"."end_chapter" is null or char_length("reader_sitting_receipts"."end_chapter") <= 300)
    and char_length("reader_sitting_receipts"."time_zone") between 1 and 100),
	CONSTRAINT "reader_sitting_receipt_retirement_check" CHECK (
    ("reader_sitting_receipts"."state" = 'active' and "reader_sitting_receipts"."session_id" is not null and "reader_sitting_receipts"."retired_at" is null and "reader_sitting_receipts"."retire_reason" is null)
    or ("reader_sitting_receipts"."state" = 'retired' and "reader_sitting_receipts"."session_id" is null and "reader_sitting_receipts"."retired_at" is not null
      and isfinite("reader_sitting_receipts"."retired_at")
      and "reader_sitting_receipts"."retire_reason" is not null
      and "reader_sitting_receipts"."retire_reason" in ('session_deleted','session_edited','reading_deleted','reading_closed','reading_edited','binding_changed','book_merged','compensated','session_missing')))
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "reading_auto_track_ebooks" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_notes" ADD COLUMN "ebook_annotation_id" uuid;--> statement-breakpoint
ALTER TABLE "legacy_reader_progress" ADD CONSTRAINT "legacy_reader_progress_ebook_id_ebooks_id_fk" FOREIGN KEY ("ebook_id") REFERENCES "public"."ebooks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_sitting_receipts" ADD CONSTRAINT "reader_sitting_receipts_session_id_reading_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."reading_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reader_quote_undo_note_idx" ON "reader_quote_undo_receipts" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "reader_sitting_receipt_session_idx" ON "reader_sitting_receipts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "reader_sitting_receipt_reading_idx" ON "reader_sitting_receipts" USING btree ("reading_id");--> statement-breakpoint
CREATE INDEX "reader_sitting_receipt_ebook_idx" ON "reader_sitting_receipts" USING btree ("ebook_id");--> statement-breakpoint
ALTER TABLE "reading_notes" ADD CONSTRAINT "reading_notes_ebook_annotation_id_ebook_annotations_id_fk" FOREIGN KEY ("ebook_annotation_id") REFERENCES "public"."ebook_annotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_notes" ADD CONSTRAINT "reading_notes_ebook_annotation_id_unique" UNIQUE("ebook_annotation_id");
--> statement-breakpoint


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
--> statement-breakpoint

CREATE TRIGGER reader_sitting_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON reader_sitting_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_reader_sitting_receipt();
--> statement-breakpoint

CREATE TRIGGER reader_sitting_receipt_no_truncate BEFORE TRUNCATE ON reader_sitting_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION guard_reader_sitting_receipt();
--> statement-breakpoint


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
--> statement-breakpoint


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
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER reader_sitting_receipt_session_check AFTER INSERT OR UPDATE ON reader_sitting_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_sitting_session();
--> statement-breakpoint


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
--> statement-breakpoint

CREATE TRIGGER reader_session_receipts_retire BEFORE UPDATE OR DELETE ON reading_sessions
  FOR EACH ROW EXECUTE FUNCTION retire_reader_session_receipts();
--> statement-breakpoint


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
--> statement-breakpoint

CREATE TRIGGER reader_reading_receipts_retire BEFORE UPDATE OR DELETE ON readings
  FOR EACH ROW EXECUTE FUNCTION retire_reader_reading_receipts();
--> statement-breakpoint


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
--> statement-breakpoint

CREATE TRIGGER reader_ebook_receipts_retire BEFORE UPDATE OR DELETE ON ebooks FOR EACH ROW EXECUTE FUNCTION retire_reader_binding_receipts();
--> statement-breakpoint

CREATE TRIGGER reader_instance_receipts_retire BEFORE UPDATE OR DELETE ON instances FOR EACH ROW EXECUTE FUNCTION retire_reader_binding_receipts();
--> statement-breakpoint

CREATE TRIGGER reader_edition_receipts_retire BEFORE UPDATE OR DELETE ON editions FOR EACH ROW EXECUTE FUNCTION retire_reader_binding_receipts();
--> statement-breakpoint


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
--> statement-breakpoint


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
--> statement-breakpoint


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
--> statement-breakpoint

CREATE TRIGGER reading_note_version_stamp BEFORE INSERT OR UPDATE ON public.reading_notes
  FOR EACH ROW EXECUTE FUNCTION public.durtal_reader_stamp_note_version();
--> statement-breakpoint


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
--> statement-breakpoint

CREATE TRIGGER reading_note_quote_epoch AFTER INSERT OR UPDATE OR DELETE ON public.reading_notes
  FOR EACH ROW EXECUTE FUNCTION public.durtal_reader_rotate_note_quote_epoch();
--> statement-breakpoint


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
  -- A paired Undo's temporary plain mark has no quote epoch. Revoke its
  -- unused evidence on actual binding changes, including A-B-A, under the
  -- same book/id-before-receipt order. Generated table precedes this function.
  UPDATE public.reader_quote_undo_receipts SET expires_at=least(expires_at,clock_timestamp())
    WHERE ebook_id=ANY(books) AND used_at IS NULL;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER reader_quote_binding_ebook_lock BEFORE UPDATE OR DELETE ON public.ebooks
  FOR EACH ROW EXECUTE FUNCTION public.durtal_reader_lock_and_rotate_binding();
--> statement-breakpoint

CREATE TRIGGER reader_quote_binding_instance_lock BEFORE UPDATE OR DELETE ON public.instances
  FOR EACH ROW EXECUTE FUNCTION public.durtal_reader_lock_and_rotate_binding();
--> statement-breakpoint

CREATE TRIGGER reader_quote_binding_edition_lock BEFORE UPDATE OR DELETE ON public.editions
  FOR EACH ROW EXECUTE FUNCTION public.durtal_reader_lock_and_rotate_binding();
--> statement-breakpoint



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
--> statement-breakpoint

DROP TRIGGER reading_note_guard ON reading_notes;
--> statement-breakpoint

CREATE TRIGGER reading_note_guard BEFORE INSERT OR UPDATE OR DELETE ON reading_notes
  FOR EACH ROW EXECUTE FUNCTION guard_reading_note();
--> statement-breakpoint


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
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER reader_quote_note_binding_check AFTER INSERT OR UPDATE ON reading_notes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_quote_binding();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER reader_quote_ebook_binding_check AFTER UPDATE ON ebooks
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_quote_binding();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER reader_quote_instance_binding_check AFTER UPDATE ON instances
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_quote_binding();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER reader_quote_edition_binding_check AFTER UPDATE ON editions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_quote_binding();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER reader_quote_annotation_binding_check AFTER UPDATE ON ebook_annotations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_quote_binding();
--> statement-breakpoint
-- EXACT SERVER/SQL COMPOSITION PROPOSAL ONLY. DO NOT APPLY.
-- This draft depends on reviewed 0083 plus SLN-454's actual 0087 note FK/guard;
-- it is NOT DDL to place in 0083 before that column exists. Root/454 own the
-- installation decision. There is no server route or database writer here.
-- Production uses Neon HTTP atomic batches: read/check/write live inside one
-- PostgreSQL function/query, never an unlocked pre-read + JavaScript decision.
-- Auth, same-origin, strict request parsing and expected-device cookie comparison
-- precede any database work. None of these functions accepts a privileged flag.
-- These SECURITY INVOKER functions are called by trusted server modules only;
-- browser routes expose no general SQL execution or arbitrary function dispatch.
-- Pre-lock book then all annotation ids in sorted order for multi-item batches.

CREATE FUNCTION public.durtal_annotation_finalize_delete(
  p_ebook_id uuid, p_annotation_id uuid, p_client_updated_at timestamptz,
  p_operation_id text, p_revision bigint, p_quote_effect jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
DECLARE a public.ebook_annotations%ROWTYPE;
        n public.reading_notes%ROWTYPE;
        owner uuid; work uuid; action text; stamp timestamptz;
BEGIN
  IF p_operation_id IS NULL OR p_operation_id = '' OR p_revision IS NULL OR p_revision < 1 OR p_revision > 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid composed operation identity' USING ERRCODE = '22023';
  END IF;
  PERFORM public.durtal_annotation_lock_book(p_ebook_id);
  PERFORM public.durtal_annotation_lock_id(p_annotation_id);
  SELECT ebook_id INTO owner FROM public.ebook_annotation_retired_ids WHERE id = p_annotation_id;
  IF FOUND THEN
    IF owner <> p_ebook_id THEN RETURN jsonb_build_object('status','conflict','reason','identity'); END IF;
    -- No note lookup or deletion on retry: another completed operation may
    -- have deliberately kept that quote. Retirement outranks every late effect.
    RETURN jsonb_build_object('status','already-retired');
  END IF;
  SELECT * INTO a FROM public.ebook_annotations WHERE id = p_annotation_id FOR UPDATE;
  IF FOUND AND a.ebook_id <> p_ebook_id THEN RETURN jsonb_build_object('status','conflict','reason','identity'); END IF;
  IF a.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('status','already-retired'); END IF;
  action := p_quote_effect->>'action';
  IF action IS NULL OR action NOT IN ('none','keep-quote','delete-quote') THEN
    RAISE EXCEPTION 'Invalid deferred quote effect' USING ERRCODE = '22023';
  END IF;
  IF (a.style IS NOT DISTINCT FROM 'quote') = (action = 'none') THEN
    RETURN jsonb_build_object('status','conflict','reason','quote-choice');
  END IF;
  IF action <> 'none' THEN
    IF a.id IS NULL THEN RETURN jsonb_build_object('status','conflict','reason','missing'); END IF;
    -- The route schema has already validated this UUID and every exact version.
    SELECT * INTO n FROM public.reading_notes WHERE id = (p_quote_effect->>'noteId')::uuid FOR UPDATE;
    SELECT ed.work_id INTO work FROM public.ebooks eb
      JOIN public.instances i ON i.id = eb.instance_id JOIN public.editions ed ON ed.id = i.edition_id
      WHERE eb.id = p_ebook_id AND eb.match_state = 'linked';
    IF n.id IS NULL OR n.kind <> 'quote' OR n.ebook_annotation_id IS DISTINCT FROM a.id OR
       work IS NULL OR n.work_id <> work THEN
      RETURN jsonb_build_object('status','conflict','reason','binding');
    END IF;
    IF to_char(n.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') IS DISTINCT FROM p_quote_effect->>'expectedNoteVersion' THEN
      RETURN jsonb_build_object('status','conflict','reason','note-version');
    END IF;
    IF a.quote_binding_version::text IS DISTINCT FROM p_quote_effect->>'expectedBindingVersion' THEN
      RETURN jsonb_build_object('status','conflict','reason','binding-version');
    END IF;
  END IF;
  IF a.id IS NULL THEN
    stamp := public.durtal_annotation_tick(p_ebook_id);
    INSERT INTO public.ebook_annotation_retired_ids (id, ebook_id, retired_at) VALUES (p_annotation_id, p_ebook_id, stamp);
  ELSE
    -- An older client delete is still final; keep the greatest edit timestamp.
    -- The lifecycle trigger stamps deletion/update and retirement together.
    UPDATE public.ebook_annotations SET deleted_at = clock_timestamp(),
      client_updated_at = greatest(client_updated_at, p_client_updated_at)
      WHERE id = a.id AND ebook_id = p_ebook_id AND deleted_at IS NULL;
  END IF;
  IF action = 'delete-quote' THEN
    DELETE FROM public.reading_notes WHERE id = n.id AND ebook_annotation_id = a.id AND work_id = work
      AND to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') = p_quote_effect->>'expectedNoteVersion';
    IF NOT FOUND THEN RAISE EXCEPTION 'Composed quote delete lost its predicate' USING ERRCODE = '40001'; END IF;
  ELSIF action = 'keep-quote' THEN
    -- Retain exact quote provenance on the old book, but detach its retired
    -- mark now. Waiting for a physical purge leaves the ownership guard
    -- blocking a later e-book unlink/relink for up to ninety days.
    UPDATE public.reading_notes SET ebook_annotation_id=NULL
      WHERE id=n.id AND ebook_annotation_id=a.id AND work_id=work
        AND to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') = p_quote_effect->>'expectedNoteVersion';
    IF NOT FOUND THEN RAISE EXCEPTION 'Composed quote keep lost its predicate' USING ERRCODE = '40001'; END IF;
  END IF;
  -- Both prepared choices are applied with retirement in this transaction.
  -- No retained note stays coupled to a mark that can never become live again.
  -- Any subsequent query/trigger failure rolls back note + tombstone + ledger.
  RETURN jsonb_build_object('status','committed');
END $$;
--> statement-breakpoint


CREATE FUNCTION public.durtal_tracker_delete_live_reader_quote(
  p_ebook_id uuid, p_annotation_id uuid, p_note_id uuid,
  p_expected_note_version text, p_expected_binding_version text, p_color text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
DECLARE a public.ebook_annotations%ROWTYPE; n public.reading_notes%ROWTYPE; work uuid;
BEGIN
  IF p_color IS NULL OR p_color NOT IN ('ochre','sage','slate','rose','violet') THEN
    RAISE EXCEPTION 'Invalid plain highlight colour' USING ERRCODE = '22023';
  END IF;
  PERFORM public.durtal_annotation_lock_book(p_ebook_id);
  PERFORM public.durtal_annotation_lock_id(p_annotation_id);
  SELECT * INTO a FROM public.ebook_annotations WHERE id = p_annotation_id FOR UPDATE;
  IF a.id IS NULL OR a.ebook_id <> p_ebook_id OR a.deleted_at IS NOT NULL OR
     EXISTS (SELECT 1 FROM public.ebook_annotation_retired_ids WHERE id = p_annotation_id) THEN
    RETURN jsonb_build_object('status','conflict','reason','retired-or-missing');
  END IF;
  IF a.style <> 'quote' THEN RETURN jsonb_build_object('status','conflict','reason','quote-choice'); END IF;
  SELECT * INTO n FROM public.reading_notes WHERE id = p_note_id FOR UPDATE;
  SELECT ed.work_id INTO work FROM public.ebooks eb
    JOIN public.instances i ON i.id = eb.instance_id JOIN public.editions ed ON ed.id = i.edition_id
    WHERE eb.id = p_ebook_id AND eb.match_state = 'linked';
  IF n.id IS NULL OR n.kind <> 'quote' OR n.ebook_annotation_id IS DISTINCT FROM a.id OR work IS NULL OR n.work_id <> work THEN
    RETURN jsonb_build_object('status','conflict','reason','binding');
  END IF;
  IF to_char(n.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') IS DISTINCT FROM p_expected_note_version THEN
    RETURN jsonb_build_object('status','conflict','reason','note-version');
  END IF;
  IF a.quote_binding_version::text IS DISTINCT FROM p_expected_binding_version THEN
    RETURN jsonb_build_object('status','conflict','reason','binding-version');
  END IF;
  -- No locator/file/passage/note/id/client-time assignments. The lifecycle
  -- trigger clears the quote epoch and stamps only server updated_at.
  UPDATE public.ebook_annotations SET style = 'highlight', color = p_color
    WHERE id = a.id AND ebook_id = p_ebook_id AND deleted_at IS NULL AND style = 'quote'
      AND quote_binding_version::text = p_expected_binding_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote conversion lost its predicate' USING ERRCODE = '40001'; END IF;
  DELETE FROM public.reading_notes WHERE id = n.id AND ebook_annotation_id = a.id AND work_id = work
    AND to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') = p_expected_note_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote delete lost its predicate' USING ERRCODE = '40001'; END IF;
  RETURN jsonb_build_object('status','committed');
END $$;
--> statement-breakpoint


CREATE FUNCTION public.durtal_reader_delete_quote_with_undo(
  p_ebook_id uuid, p_annotation_id uuid, p_note_id uuid,
  p_note_version text, p_binding_version text, p_token uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
DECLARE n public.reading_notes%ROWTYPE; copy uuid; edition uuid; result jsonb; fingerprint text;
BEGIN
  PERFORM public.durtal_reader_lock_quote_notes(ARRAY[p_note_id],ARRAY[p_annotation_id]);
  SELECT * INTO n FROM public.reading_notes WHERE id=p_note_id;
  SELECT i.id,e.id INTO copy,edition FROM public.ebooks eb
    JOIN public.instances i ON i.id=eb.instance_id JOIN public.editions e ON e.id=i.edition_id
    WHERE eb.id=p_ebook_id AND eb.match_state='linked' AND e.work_id=n.work_id;
  IF n.id IS NULL OR n.ebook_annotation_id IS DISTINCT FROM p_annotation_id OR copy IS NULL THEN
    RETURN jsonb_build_object('status','conflict','reason','binding');
  END IF;
  result:=public.durtal_tracker_delete_live_reader_quote(p_ebook_id,p_annotation_id,p_note_id,p_note_version,p_binding_version,'ochre');
  IF result->>'status' IS DISTINCT FROM 'committed' THEN RETURN result; END IF;
  SELECT md5(to_jsonb(a)::text) INTO fingerprint FROM public.ebook_annotations a WHERE a.id=p_annotation_id;
  INSERT INTO public.reader_quote_undo_receipts(token,note_id,ebook_id,annotation_id,work_id,instance_id,edition_id,
    note_snapshot,annotation_fingerprint,expires_at)
    VALUES(p_token,n.id,p_ebook_id,p_annotation_id,n.work_id,copy,edition,
      -- Ten-second UI Undo plus bounded transport grace; all state predicates
      -- still apply, and this proof cannot authorize retirement resurrection.
      to_jsonb(n)-'search_text',fingerprint,clock_timestamp()+interval '30 seconds');
  RETURN jsonb_build_object('status','committed','token',p_token,'ebookId',p_ebook_id);
END $$;
--> statement-breakpoint


CREATE FUNCTION public.durtal_reader_restore_quote(p_token uuid,p_note_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
DECLARE u public.reader_quote_undo_receipts%ROWTYPE; a public.ebook_annotations%ROWTYPE;
        n public.reading_notes%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.reader_quote_undo_receipts WHERE token=p_token;
  IF u.token IS NULL OR u.note_id<>p_note_id THEN RETURN jsonb_build_object('status','conflict','reason','undo-identity'); END IF;
  -- Discover first, then book/annotation/note, then receipt row. Never lock
  -- receipt/note before acquiring the shared annotation protocol.
  PERFORM public.durtal_reader_lock_quote_notes(ARRAY[u.note_id],ARRAY[u.annotation_id]);
  SELECT * INTO u FROM public.reader_quote_undo_receipts WHERE token=p_token FOR UPDATE;
  IF u.used_at IS NOT NULL THEN RETURN jsonb_build_object('status','replayed'); END IF;
  IF u.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('status','conflict','reason','undo-expired'); END IF;
  SELECT * INTO a FROM public.ebook_annotations WHERE id=u.annotation_id FOR UPDATE;
  IF a.id IS NULL OR a.ebook_id<>u.ebook_id OR a.deleted_at IS NOT NULL OR a.style<>'highlight'
    OR EXISTS(SELECT 1 FROM public.ebook_annotation_retired_ids WHERE id=u.annotation_id)
    OR md5(to_jsonb(a)::text)<>u.annotation_fingerprint THEN
    RETURN jsonb_build_object('status','conflict','reason','highlight-changed');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ebooks eb JOIN public.instances i ON i.id=eb.instance_id
    JOIN public.editions e ON e.id=i.edition_id WHERE eb.id=u.ebook_id AND eb.match_state='linked'
      AND i.id=u.instance_id AND e.id=u.edition_id AND e.work_id=u.work_id)
    OR EXISTS(SELECT 1 FROM public.reading_notes WHERE id=u.note_id OR ebook_annotation_id=u.annotation_id) THEN
    RETURN jsonb_build_object('status','conflict','reason','binding-changed');
  END IF;
  n:=jsonb_populate_record(NULL::public.reading_notes,u.note_snapshot);
  UPDATE public.ebook_annotations SET style='quote',color=NULL WHERE id=u.annotation_id;
  INSERT INTO public.reading_notes(id,work_id,reading_id,edition_id,ebook_annotation_id,kind,body,comment_html,comment_json,
    page,end_page,page_roman,chapter,percent,is_favourite,source,import_id,source_key,created_at,updated_at)
    VALUES(n.id,n.work_id,
      CASE WHEN EXISTS(SELECT 1 FROM public.readings WHERE id=n.reading_id AND work_id=n.work_id) THEN n.reading_id ELSE NULL END,
      CASE WHEN EXISTS(SELECT 1 FROM public.editions WHERE id=n.edition_id AND work_id=n.work_id) THEN n.edition_id ELSE NULL END,
      u.annotation_id,n.kind,n.body,n.comment_html,n.comment_json,n.page,n.end_page,n.page_roman,n.chapter,n.percent,n.is_favourite,
      n.source,CASE WHEN EXISTS(SELECT 1 FROM public.imports WHERE id=n.import_id) THEN n.import_id ELSE NULL END,
      n.source_key,n.created_at,n.updated_at);
  UPDATE public.reader_quote_undo_receipts SET used_at=clock_timestamp() WHERE token=p_token;
  RETURN jsonb_build_object('status','committed');
END $$;
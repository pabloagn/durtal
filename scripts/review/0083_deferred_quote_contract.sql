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
  END IF;
  -- keep-quote intentionally keeps the note. Its soft-deleted annotation is
  -- treated as no highlight; 0087's FK clears the pointer at physical purge.
  -- Any subsequent query/trigger failure rolls back note + tombstone + ledger.
  RETURN jsonb_build_object('status','committed');
END $$;

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

-- 0087/source obligations for root/454 exact review:
-- * reading_notes.ebook_annotation_id FK ON DELETE SET NULL; one note per
--   annotation, with real linked book/edition/work validation, deferred as
--   needed for createHighlight + note insertion and audited catalogue merges.
-- * Rotate the annotation's quote_binding_version when its real note/book
--   association changes. The new epoch must be server-issued, never supplied
--   by a browser. Update note versions monotonically at PostgreSQL precision.
-- * An edited quote passage cannot silently overwrite the annotation's immutable
--   original text/anchor; reconcile this case explicitly in tracker source.
-- * All note/book binding writers coordinate with the same book/id lock order;
--   existing generic note actions cannot bypass the composed live-quote delete.
-- * A quote linked only to a retired/soft-deleted annotation is an ordinary
--   retained tracker quote: deleting it must not recreate or convert the mark.
-- * No composed function can be dispatched by name from a browser request.
--   There is no SQL role/GUC flag offered as a substitute for route validation.
-- * Results are echoed with decoded operation/revision and the local claim
--   token by the transport adapter. Only that exact revision is acknowledged;
--   conflicts retain the sealed whole operation. Already-retired means no new
--   quote effect ran, not proof that this request's chosen quote was deleted.

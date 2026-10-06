-- SLN-490: the old e-book library goes. Its tables and the copies' links to it
-- were empty on live on 4 October 2026; stop if that changed, so nothing is
-- dropped without a word. Then the digital location keeps its copies under
-- its new name.
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM reading_progress;
  IF n > 0 THEN
    RAISE EXCEPTION 'reading_progress holds % rows; this migration expects none (live had none on 4 October 2026). Ask the coordinator.', n;
  END IF;
  SELECT count(*) INTO n FROM calibre_books;
  IF n > 0 THEN
    RAISE EXCEPTION 'calibre_books holds % rows; this migration expects none (live had none on 4 October 2026). Ask the coordinator.', n;
  END IF;
  SELECT count(*) INTO n FROM instances WHERE calibre_id IS NOT NULL OR calibre_url IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% copies have a calibre_id or calibre_url; this migration expects none (live had none on 4 October 2026). Ask the coordinator.', n;
  END IF;
  SELECT count(*) INTO n FROM image_adjustments
    WHERE asset_key LIKE 'gold/calibre/%' OR sources::text LIKE '%/api/reader/%';
  IF n > 0 THEN
    RAISE EXCEPTION '% image adjustments are for covers of the old reader; this migration expects none (live had none on 4 October 2026). Ask the coordinator.', n;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "locations" SET "name" = 'eBooks' WHERE "name" = 'Calibre' AND "type" = 'digital';
--> statement-breakpoint
INSERT INTO "locations" ("name", "type")
SELECT 'eBooks', 'digital'
WHERE NOT EXISTS (SELECT 1 FROM "locations" WHERE "name" = 'eBooks' AND "type" = 'digital');

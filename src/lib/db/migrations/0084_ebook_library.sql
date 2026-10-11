-- SLN-497 review draft. Not registered in the journal: generate only after
-- coordinator approval on the approved prerequisite snapshots (0082/0083).
-- Drizzle declarations own the four indexes below; functions/triggers/backfill
-- are manual SQL that must be retained when the generated migration is assembled.
CREATE FUNCTION public.ebook_title_sort(title text, language text) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  normalized text := public.search_normalize(coalesce(title, ''));
  code text := split_part(replace(lower(trim(coalesce(language, ''))), '_', '-'), '-', 1);
  articles text[] := CASE
    WHEN code IN ('en', 'eng', 'english') THEN ARRAY['the', 'a', 'an']
    WHEN code IN ('fr', 'fra', 'fre', 'french') THEN ARRAY['le', 'la', 'les', 'l', 'un', 'une', 'des']
    WHEN code IN ('es', 'spa', 'spanish') THEN ARRAY['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']
    WHEN code IN ('de', 'deu', 'ger', 'german') THEN ARRAY['der', 'die', 'das', 'ein', 'eine']
    WHEN code IN ('it', 'ita', 'italian') THEN ARRAY['il', 'lo', 'la', 'l', 'i', 'gli', 'le', 'un', 'uno', 'una']
    WHEN code IN ('pt', 'por', 'portuguese') THEN ARRAY['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas']
    WHEN code IN ('nl', 'nld', 'dut', 'dutch') THEN ARRAY['de', 'het', 'een']
    ELSE ARRAY[]::text[] END;
  token text;
  significant text;
  result text := '';
BEGIN
  -- An article-only title stays under its own name. Strip exactly one.
  IF strpos(normalized, ' ') > 0 AND split_part(normalized, ' ', 1) = ANY(articles) THEN
    normalized := substr(normalized, strpos(normalized, ' ') + 1);
  END IF;
  FOR token IN SELECT (regexp_matches(normalized, '([0-9]+|[^0-9]+)', 'g'))[1] LOOP
    IF token ~ '^[0-9]+$' THEN
      significant := coalesce(nullif(ltrim(token, '0'), ''), '0');
      result := result || lpad(length(significant)::text, 10, '0') || ':' ||
        lpad(significant, greatest(6, length(significant)), '0');
    ELSE
      result := result || token;
    END IF;
  END LOOP;
  RETURN result;
END $$;

--> statement-breakpoint
CREATE FUNCTION public.ebook_title_sort_set() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.title_sort := public.ebook_title_sort(NEW.title, NEW.language);
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER ebook_title_sort_set BEFORE INSERT OR UPDATE OF title, language ON ebooks
FOR EACH ROW EXECUTE FUNCTION public.ebook_title_sort_set();

--> statement-breakpoint
UPDATE ebooks SET title_sort = public.ebook_title_sort(title, language);
--> statement-breakpoint
CREATE INDEX "ebook_ingest_items_ebook_created_idx" ON "ebook_ingest_items" USING btree ("ebook_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "ebooks_state_title_sort_idx" ON "ebooks" USING btree ("match_state","title_sort" collate "C","id");--> statement-breakpoint
CREATE INDEX "ebooks_created_at_idx" ON "ebooks" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ebooks_active_title_sort_idx" ON "ebooks" USING btree ("title_sort" collate "C","id") WHERE "ebooks"."match_state" <> 'excluded';
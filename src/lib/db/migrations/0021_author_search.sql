-- Author search (task 0119): accent- and case-insensitive, typo-tolerant.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;--> statement-breakpoint
-- Remove accents (precomposed via unaccent, leftover combining marks via the
-- first regexp), lower-case, and turn punctuation/space runs into one space.
-- Declared IMMUTABLE (with an explicit dictionary) so generated columns and
-- indexes can use it. Mirrors normalizeSearchText() in src/lib/utils/search-text.ts.
CREATE OR REPLACE FUNCTION public.search_normalize(input text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT trim(regexp_replace(
    lower(regexp_replace(public.unaccent('public.unaccent'::regdictionary, input), '[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]', '', 'g')),
    '[[:space:][:punct:]]+', ' ', 'g')) $$;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "search_text" text GENERATED ALWAYS AS (search_normalize(coalesce(name, '') || ' ' || coalesce(real_name, '') || ' ' || coalesce(sort_name, '') || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) STORED;--> statement-breakpoint
CREATE INDEX "authors_search_text_trgm_idx" ON "authors" USING gin ("search_text" gin_trgm_ops);
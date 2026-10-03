-- One stored form per language: ISO 639-1 when the language has one, otherwise
-- ISO 639-3 (then ISO 639-2). Matching uses the `languages` reference table and
-- accepts any of its codes (639-2 B or T: "fre", "fra"), a regional tag
-- ("en-US", "en_GB") or the English name ("English"), in any case.
-- NULL when the value is unknown or names two different languages.
CREATE FUNCTION language_code(value text) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
 WITH input AS (
   SELECT lower(trim(value)) AS raw,
          split_part(replace(lower(trim(value)), '_', '-'), '-', 1) AS base
 ), matches AS (
   SELECT DISTINCT coalesce(
     nullif(split_part(l.iso_639_1, '/', 1), ''),
     nullif(split_part(l.iso_639_3, '/', 1), ''),
     nullif(split_part(l.iso_639_2, '/', 2), ''),
     nullif(split_part(l.iso_639_2, '/', 1), '')) AS code
   FROM languages l, input i
   WHERE lower(l.name) = i.raw
      OR i.base = ANY (string_to_array(lower(l.iso_639_1), '/'))
      OR i.base = ANY (string_to_array(lower(l.iso_639_2), '/'))
      OR i.base = ANY (string_to_array(lower(l.iso_639_3), '/'))
 )
 SELECT min(code) FROM matches HAVING count(code) = 1
$$;
--> statement-breakpoint
-- The stored value for a language column. A value the reference table does not
-- know is kept only when it already has the form of a code (2-3 lowercase
-- letters), so a database without reference data still accepts codes.
-- Names, regional tags and other text that cannot be resolved are rejected.
CREATE FUNCTION stored_language(value text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE code text := language_code(value);
BEGIN
 IF code IS NOT NULL THEN RETURN code; END IF;
 IF trim(value) ~ '^[a-z]{2,3}$' THEN RETURN trim(value); END IF;
 RAISE EXCEPTION 'Unknown language: %', value USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
CREATE FUNCTION normalize_edition_language() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.language := stored_language(NEW.language); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER edition_language_code BEFORE INSERT OR UPDATE OF language ON editions
 FOR EACH ROW EXECUTE FUNCTION normalize_edition_language();
--> statement-breakpoint
CREATE FUNCTION normalize_work_language() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.original_language := stored_language(NEW.original_language); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER work_language_code BEFORE INSERT OR UPDATE OF original_language ON works
 FOR EACH ROW EXECUTE FUNCTION normalize_work_language();
--> statement-breakpoint
-- Existing values ("eng", "English", "fre") take the stored form. A value that
-- cannot be resolved stops the migration.
UPDATE editions SET language = language WHERE language IS DISTINCT FROM language_code(language);
--> statement-breakpoint
UPDATE works SET original_language = original_language WHERE original_language IS DISTINCT FROM language_code(original_language);

# Task 0204: Author enrichment from Wikidata

**Status**: In Progress
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0201
**Blocks**: None

## Overview
The owner asked for the same research as the publishers (task 0201) for author data, which had many holes and some wrong values. This first pass covers the 407 authors linked to books. Each author is matched to a Wikidata person only with evidence, and only empty fields are filled. Posters, backgrounds, photos and all other images are never read or written: they are chosen by hand.

## Implementation Details
- `src/lib/wikidata/api.ts`: the Wikidata client the publisher and author enrichments share. The Action API is used one call at a time. Names go 20 at a time to the reconciliation service (wikidata-reconciliation.wmcloud.org), and a person's works 80 people at a time to the query service, which allows about one query a minute.
- `src/lib/authors/wikidata.ts`: the facts read from a person (P31, P21, P569, P570, P19, P20, P27, P106, P1477, P648, P2963, P856, P800, P135) and a place (P17, P297, P576, P625, P131). Dates keep their precision, calendar and circa qualifiers. Years before Christ are negative, with no year 0.
- `src/lib/authors/enrichment.ts` (pure): the rules.
  - **Name:** the label or an alias is a form of the author's name (inverted sort name, real name, aliases, without "Sir" or "Saint"), the same words in another order ("Yan Mo" for Mo Yan), the same without particles or initials, or the same family name with fitting initials.
  - **What rules a person out:** not human; another gender; a birth or death year more than a year from the catalogue's; a book of the author's older than the person.
  - **What holds a match for review:** a year one off, a day of the month that differs, a nationality that differs.
  - **Evidence:** one of the author's books among the person's works or notable works; birth and death years, days of the month and nationality that agree.
  - **Confidence:** high needs a book, or a year plus a second fact. Medium is the only person whose name fits exactly, with a fact the catalogue already holds.
  - **Fill (empty fields only):** dates to the precision given (circa and decades set the approximate flag; centuries are not taken), the Gregorian year of a Julian date, the zodiac sign (from the Gregorian day), gender (P21 only), nationality (the one citizenship that is a country today, or the description's demonym, never against it; none for antiquity), birth and death places (a building gives its town), birth name (Latin script), website, Open Library key, Goodreads id, and an About text built from Wikidata facts (description, where and when born and died, notable works, movements).
  - **Corrections:** a year before Christ stored without its minus sign. Every other difference is reported and left as it is.
- `src/lib/authors/enrichment-review.ts`: decisions after research, each with its reason. They cover authors that are another author twice (merged in the app), facts Wikidata has wrong, and broken sort names.
- `scripts/authors/enrich.ts`: dry run in one rolled-back transaction by default. `--apply` commits, and `--undo FILE` restores the authors and removes the run's identifiers, records and new places. Places are matched by Wikidata id, then by name, type and parent, and new ones carry the country, full name and coordinates. A person belongs to one author. Two authors that match one person are held as a possible duplicate. An edit made during the run is never overwritten. The person is stored in `catalogue_identifiers` (provider `wikidata`, entity kind `person`) and the facts used in `source_records`.
- Years before Christ show as "428 BC" on the author page, cards, list rows, the map, the timeline and the home page (`src/lib/utils/years.ts`).
- Docs: `docs/02_DATA_MODEL.md` (authors: year columns, enrichment; places).

## Completion Notes
- Pending: dry runs, review, apply.

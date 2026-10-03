# Task 0201: Publisher enrichment from Wikidata (SLN-330)

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0179, 0194
**Blocks**: None

## Overview
The owner asked for the publisher country fix to be done with proper research, and for the publishers to be enriched. Every publishing house with a book profile was researched on Wikidata, each match was checked against what the catalogue knows, and only empty fields were filled: country, website and an "About" text. Every country link now follows the country text with the exact match of task 0194.

## Implementation Details
- `src/lib/publishers/wikidata.ts`: Wikidata Action API (`wbsearchentities`, `wbgetentities`). The query service was rate-limited during an outage. Calls go one every two seconds and honour 429 Retry-After and `maxlag`, and every answer is cached so the dry run and the apply read the same data.
- `src/lib/publishers/enrichment.ts` (pure): the rules.
  - **Searches:** the name, its short form ("Tin House" for "Tin House Books"), "Books" and "Press" forms of a bare name, and the aliases.
  - **Publisher check:** an item counts as a publisher when it is filed as one (an instance of a subclass of publisher or imprint). Failing that, its description must say "publisher" and its name must match exactly; a person never counts.
  - **Name ranks:** the label is the house's name; the label is an alias, or an alias is the name; aliases meet; a close form. A stray alias alone never matches ("Random House Publishing Group" on Dell Publishing).
  - **What rules an item out:** the country text; the publication countries of the house's books; their ISBN registration groups; a house that closed before its own books came out; a country named in the description ("American publisher" against a UK house).
  - **What counts as evidence:** the country agrees, the books were published there, the same parent house, or the ISBN group fits.
  - **Order and confidence:** a country the catalogue states outranks where most copies were printed. High confidence needs evidence. Medium is the only same-name publisher on Wikidata.
  - **About text:** built from Wikidata facts: its description (generic one-word ones dropped), the founding year and today's base (addresses and buildings skipped). The description keeps its own date or place when it gives one, and known typos are corrected.
- `src/lib/publishers/enrichment-review.ts`: decisions made after research, each with its reason.
  - 18 item decisions where the rules hold a house or would take the wrong item. 14 were accepted, among them Knopf, Bloomsbury, Brill, Penguin Books, Creation Books and Phoenix. 4 were refused: Dell for Random House Publishing Group, HarperCollins UK, Minerva Press and Vintage Classics.
  - 22 countries for houses Wikidata does not place, from their history or their ISBN range (978-80, 978-84, 978-605, 978-1-77, 978-1-909).
- `scripts/publishers/enrich.ts`: dry run in one rolled-back transaction by default. `--apply` commits, and `--undo FILE` restores the houses and removes the run's provenance. One Wikidata item belongs to one house. The item is stored in `catalogue_identifiers` (provider `wikidata`), and the facts used in `source_records` (accepted, "Wikidata (CC0)", with the run id and the evidence). It replaces `scripts/publishers/country-links.ts`.
- Docs: `docs/02_DATA_MODEL.md` (publishing_houses, enrichment).

## Completion Notes
- Six dry runs on live data, read line by line. The review found and fixed:
  - a shared item (HarperCollins);
  - a stray alias (Dell);
  - a person (Peter Owen);
  - an 18th-century namesake (Minerva Press);
  - an American line given to a UK imprint (Vintage Classics);
  - a street address as a place (195 Broadway);
  - founding history written as today's base (Thomas Nelson).
- Tests: 22 unit tests (`src/__tests__/utils/publisher-enrichment.test.ts`). Unit suite: 916 passed.
- Applied to live as run `030f5aa9-5ee1-4a85-a4ef-b37805631949`, after a backup (`~/personal/durtal-backups/live-before-publisher-enrichment-20261003-150841.dump`). The undo file and the report are in the same folder.
- Results:
  - 164 houses matched (154 high, 10 medium).
  - 55 countries filled; 254 of 255 houses now have a country and a link. Ren Kitap stays empty: its one record is unreliable.
  - 136 websites and 155 About texts.
  - 188 links set; none removed, and none points to the US islands or the British Indian Ocean Territory.
  - 164 Wikidata identifiers and source records.
- 87 houses have no Wikidata item (small presses); their country text was already set.
- Follow-up after a review by the curated-library session:
  - The payload hash now follows the provenance rule: sha256 of the payload with sorted keys (`sourcePayloadHash`, test added). The 164 live records of the run were replaced with identical ones carrying the right hash (`--rehash`, after a backup). Records can be deleted and added but not edited, and the houses were not touched.
  - `--undo` removes only the identifiers its run created, which the undo file now lists. An older undo file falls back to the identifiers its run's records point to.
  - A Wikidata item that already belongs to another house is held with both names, instead of stopping the run.


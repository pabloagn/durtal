# Task 0204: Author enrichment from Wikidata

**Status**: Completed
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
- Eight dry runs on live data, read line by line. The review found and fixed:
  - names stored only in "mul" (Victor Hugo, Ágota Kristóf): read as well as English, which also helps the publisher reader;
  - birthplaces in today's borders held against a nationality (Bruno Schulz, Jan Potocki, Joseph Conrad): a birthplace can now only agree;
  - near titles missed ("The Bridge Over the Drina", "Decline and Fall…, Volumes 1 to 6");
  - works read for too few namesakes (six Mark Fishers);
  - dates that differ only in the day: the shared year, or year and month, is now taken;
  - a building as a birthplace (Dostoyevsky's hospital) and Paris arrondissements in About texts.
- Research by hand, each checked against English Wikipedia:
  - 14 values put right: the birth days of Denis Johnson, Marina Dyachenko, Patrick McGrath and Bothayna Al-Essa; Christopher Zeischegg's birth date; months for Imre Madách and Marguerite Young, where Wikidata's day is wrong; Patrick Senécal's nationality (Canada, not France).
  - 7 birth names Wikidata has wrong or uncertain are not filled (John Steinbeck, Ian McEwan, Luis Martín-Santos, Aldous Huxley, Dante, Marcus Aurelius, Petronius).
  - 12 people accepted (among them Homer, Moses de León, Mary Beard, Eça de Queirós) and 5 refused (Anonymous, Unknown, Luther Blissett, Melissa Brown, Donald A. Neumann).
  - The four deaths in 2025 and 2026 (Mario Vargas Llosa, Dan Simmons, António Lobo Antunes, Péter Nádas) agree with Wikipedia to the day.
  - 10 broken sort names put right (Graham Greene, Christopher R. Browning, Kanan Makiya, Mujica Lainez, Castellanos Moya, De La Pava, Alain-Fournier, Yan Lianke, Mo Yan, Daša Drndić).
- Websites are filled only when they answer: 8 dead ones were left out.
- Tests: 33 unit tests (`src/__tests__/utils/author-enrichment.test.ts`). Unit suite: 958 passed.
- Applied to live as run `b5228b03-11c5-4829-a535-2caea9f0f0da`, after a backup (`~/personal/durtal-backups/live-before-author-enrichment-20261003-185401.dump`). The undo file and the report are in the same folder (`author-enrichment-undo.json`, `author-enrichment-applied.md`).
- Results, of the 407 authors with books:
  - 393 matched (338 high, 43 medium, 12 reviewed); 8 held; 6 not found (organizations, a duo and three small-press authors).
  - Before → after: no birth year 356 → 23; no gender 99 → 11; no nationality 107 → 31; a birthplace 0 → 375; an About text 1 → 391; a day without its month 46 → 2.
  - Also filled: 269 death years, 97 birth names, 87 websites, 347 Open Library and 310 Goodreads ids, 354 zodiac signs.
  - 689 new places (country, region, town), 684 with coordinates: the author map now places people at their birthplace.
  - 393 Wikidata identifiers and source records; every payload hash matches.
  - No photo, poster, background or other media row was written.
- Checked on :3100: Plato ("c. 428 BC - c. 348 BC"), Seneca ("4 BC–65") in the grid and list, Victor Hugo, the map popup and the timeline. Alignment audit: no deviation on the author page, the authors grid, list, map and timeline, and the home page. Design audit: no low contrast from this change. The timeline's 10px end-of-bar year labels in muted grey were already below 4.5:1; reported to the session that owns the type scale.
- Left for the owner:
  - merge in the app: Calvino into Italo Calvino; McEwan,IanRussell into Ian McEwan; Miguel Cervantes into Miguel de Cervantes; Petronius Arbiter into Petronius; Saint Augustine (of Hippo) into Augustine of Hippo; Sir Arthur Conan Doyle into Arthur Conan Doyle; Auguste comte de Villiers de L'Isle-Adam into Auguste Villiers de l'Isle-Adam;
  - rename in the app: "Makiya, Kanan" to Kanan Makiya, "Yan Mo" to Mo Yan, "Daša Drndic" to Daša Drndić;
  - the 1,759 canon people without books: a second pass.

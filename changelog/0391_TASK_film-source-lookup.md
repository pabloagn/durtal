# Task 0391: Film source lookup

**Status**: Completed
**Created**: 2026-10-07
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0331 (SLN-375), SLN-358
**Blocks**: None

## Overview

SLN-376. Film facts can be looked up and reviewed before anything is saved.
The sources were evaluated: Wikidata is the one film source with a documented
public API and no key, and is looked up; TMDB needs an account key, IMDb has
no public API and Letterboxd's API is for approved applications only, so they
are cited by hand. A lookup fills empty fields and adds cast, crew, companies,
ids, the running time and releases with their source; it never replaces or
removes what the film has, since Wikidata's lists are often partial. A remake
stays a separate film. Manual entry stays complete without any source. No
schema change.

## Implementation Details

- `src/lib/catalogue/film-sources.ts`: the evaluation (`FILM_SOURCES`: access,
  why, what each has; TMDB's required notice is quoted),
  `releaseFormat` (a festival by its place's name, else theatrical, no place
  "other"), and `filmSourceChanges` (what changed between two answers).
- `src/lib/providers/wikidata.ts`: the Wikidata calls the perfume and film
  providers now share (`wikidataApi`, `wikidataEntities` 50 ids to a call,
  statements by rank, qualifiers, `wikidataDate`). Each provider sends its own
  User-Agent. `wikidata-perfumes.ts` is moved onto it with no change in what
  it asks or returns.
- `src/lib/providers/wikidata-films.ts`: the SLN-375 contract for films, at
  the work, version and release levels. Search takes a title
  (`wbsearchentities`), a Wikidata id or link, an IMDb `tt` id or a TMDB movie
  link (`haswbstatement` P345 / P4947), keeps items of a film class (P31), and
  gives each hit its year and directors so a remake reads apart. Detail reads
  titles (P1476 as the original title when it differs), the earliest P577 (deprecated
  ones left out) as the first release and every P577 with its place (P291)
  as a release, countries (P495), languages (P364), running time (P2047 in
  minutes, seconds or hours), cast and crew from nine properties (billing
  order from P1545 when every member has one; characters from P453 and P4633;
  people without an English name counted, not named), production companies
  (P272), the IMDb, TMDB and Letterboxd ids, and a poster (P3383, else P18 as a
  still) with its author and license from Commons. A Commons failure leaves
  the film without its image. One call a second, 20 s each.
- `src/lib/providers/registry.ts`: provider ids are unique per collection, so
  films and perfumes both use the `wikidata` id; `providerById(id, domain)`.
- `src/lib/providers/identity-match.ts`: `matchIdentity` (a Wikidata id, then
  one exact name) moved out of `perfume-sources.ts` for both lookups.
- `src/lib/actions/film-sources.ts`: `searchFilmSource`, `reviewFilmSource`
  (each field `fill`, `same`, `conflict`, `locked` or `unlisted`; credits and
  companies matched by Wikidata id, then one exact name; ids with any film
  holding them; the running time against the first version; releases with
  their country and format; the poster; the years here and on Wikidata; the
  film holding this item; what changed since the last accepted answer) and
  `applyFilmSource` (checks the fingerprint, fetches again, keeps an accepted
  observation; fills chosen empty fields; adds chosen credits and companies,
  made when missing, credited as attributed with their Wikidata ids;
  registers chosen ids; puts the running time and chosen releases on the first
  version, or a new one, each citing the answer). A locked source, another
  film holding the item, or a first release more than a year apart without
  "It is the same film" refuses the save.
- Film page: "Look up" in Sources opens "Look up on Wikidata": search, then
  the review with a switch per field, credit, company, id, release, the
  running time and the poster (off until chosen; saved through
  `/api/media/from-url` with its Commons credit, license and page).
- Docs: 04, 06, 08 (film sources table, calls, summary row), 14.

## Completion Notes

- `src/__tests__/catalogue/film-sources.test.ts` (unit, Wikidata and Commons
  answered by a fixture in the API's own shape): the evaluation; search by
  title keeps films only and tells the 1972 film from its 2002 remake; a
  Wikidata, IMDb or TMDB id or link finds the one item; detail parses titles,
  dates, runtimes, cast order, characters and the Commons terms; a crowded
  cast is named in pages of 50 ids; an error, a 429 and a 20 s timeout come
  back as the contract's errors; a Commons failure keeps the film;
  `releaseFormat`, `earliestDate` and `filmSourceChanges`.
- `src/__tests__/integration/film-sources.test.ts` (5 tests, local
  PostgreSQL): a review sets each field against the film; a save fills only
  empty fields, adds credits, companies, ids, the running time and releases
  with their source, and the same save again adds nothing; a remake's item,
  an item another film holds and a different year without confirmation are
  refused; a different value stays, a locked source refuses the save, and a
  later answer lists its changes; Wikidata offline or rate limited returns an
  error and changes nothing.
- Film page: the "In the collection" link was 20px high beside the rating's
  44px touch target (WCAG 2.5.8 spacing, `interaction-audit.mjs` at 390px);
  inline padding makes it 28px with no change to the line.
- Checked in the cloud: typecheck, lint (0 errors, 77 warnings as on main),
  deadcode; `scripts/qa/test-local.py` 265 files, 2,971 of 2,971 passed;
  build; page weight (/films 264 of 300 KB); phone, interaction and film
  journey audits; the alignment, design, overflow and touch audits on /films
  and a film page in headless Chrome, Firefox and WebKit at 1440, 768 and
  390px (18 of 18), and on the lookup dialog in each state (search, hits,
  review, review with "It is the same film" on) in the same browsers and
  widths (36 of 36), with the preview's Wikidata answered by the test fixture.
- The cloud build cannot reach wikidata.org, Commons or TMDB (the proxy
  refuses them), so the fixtures were written by hand in the documented
  answer shapes and the sources' terms were not re-read live for this task.
  One live lookup on the Mac (for example "Solaris") is worth doing after
  landing.

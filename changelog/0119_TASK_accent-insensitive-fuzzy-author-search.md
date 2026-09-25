# Task 0119: Accent-Insensitive, Fuzzy Author Search

**Status**: Completed
**Created**: 2026-09-24
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Searching "Peter Nadas" must find "Péter Nádas". Author search must ignore accents and be smarter overall: a sophisticated, well-ranked search, not a naive substring match.

## Implementation Details

### Current behavior (confirmed in code)

Server-side search is plain `ilike` on `authors.name`, with no normalization:

- `src/lib/actions/authors.ts`: `getAuthors` (:40), `getAuthorCount` (:159), `searchAuthorsLite` (:389), and `findOrCreateAuthor` (:376, exact `ilike`, so the wizard can create a duplicate "Peter Nadas").
- `src/lib/actions/author-map.ts:42`, `src/lib/actions/author-timeline.ts:42` (map and timeline views).
- `src/lib/actions/works.ts:68` (library search by author name), `src/lib/actions/collections.ts:147`.
- `src/app/api/authors/route.ts` (via `getAuthors`).

Client-side pickers filter with `toLowerCase().includes()`, also accent-sensitive:

- `src/components/books/work-quick-edit-dialog.tsx:185`
- `src/components/books/edition-form.tsx:216`
- `src/app/library/[slug]/work-edit-dialog.tsx:144`
- `src/app/authors/[slug]/author-merge-dialog.tsx:38`

No migration creates `unaccent` or `pg_trgm`, and there is no trigram index on authors.

### Target behavior

- Accent- and case-insensitive ("nadas" finds "Nádas").
- Word-order independent ("Nadas Peter" finds "Péter Nádas").
- Matches `name`, `sort_name`, `real_name` (pen names), and first/last name.
- Typo-tolerant (trigram similarity), with results ranked: exact > prefix > word match > fuzzy.
- One shared search function used by every site above, so behavior is consistent.
- Client pickers use the same normalization (`normalize("NFD")` + strip combining marks), or call the server search.
- `findOrCreateAuthor` uses the normalized match to prevent accent-variant duplicates.

### Proposed approach

- Migration: enable `unaccent` and `pg_trgm` (confirm both are available on Neon), add an immutable `unaccent` wrapper, and a GIN trigram index on the normalized name (or a generated `name_search` column). Update `docs/02_DATA_MODEL.md`.
- Rank with `similarity()` / `word_similarity()` plus prefix bonuses.

### Open questions

- Extend the same search to work titles, series, venues and places? (Likely yes, as a follow-up.)

## Completion Notes

### Database (migration `0021_author_search`, applied to local copy and live Neon)

- Extensions `unaccent` and `pg_trgm` (schema `public`).
- IMMUTABLE function `search_normalize(text)`: `unaccent`, strip leftover combining marks, `lower`, punctuation and whitespace runs to one space.
- Generated stored column `authors.search_text` = `search_normalize(name, real_name, sort_name, first_name, last_name)` and GIN trigram index `authors_search_text_trgm_idx`.
- `docs/02_DATA_MODEL.md` updated.

### Server search (`src/lib/actions/utils/author-search.ts`)

- `authorSearchCondition(query, { fuzzy })`: every query word must appear in `search_text` (any order). With `fuzzy`, a word of 4+ letters may be a typo (`strict_word_similarity >= 0.4`), and a multi-word query may match as a whole (`>= 0.6`).
- `authorSearchRank(query)`: exact name 1000 > name prefix 800 > word prefix 600 > all words as word prefixes 400 > all words anywhere 200, plus 100 x strict word similarity and 50 x name similarity.
- `authorNameEquals(name)` for `findOrCreateAuthor`: "Peter Nadas" now reuses "Péter Nádas"; the exact spelling wins, then the oldest.
- Used by `getAuthors`, `getAuthorCount`, `getAuthorsForMap`, `getAuthorsForTimeline`, `searchAuthorsLite` (ranked), library search (author part) and `searchEditionsForPicker`. Library and collection searches use `fuzzy: false` to keep book results precise.
- `/authors`: a search sorts by "Best match" by default (new sort option, shown only while searching); the user can still pick any other sort.

### Client (`src/lib/utils/search-text.ts`)

- `normalizeSearchText()` mirrors `search_normalize()` (checked on all 2,539 name and real-name values: 0 differences).
- `searchScore()` / `filterBySearch()`: accent-, case- and word-order-insensitive filter with ranking (exact > starts with > word start > all word starts > contains). Used by the work quick edit, edition form, work edit and author merge pickers.
- `slugify.ts` now exports `transliterate()` (same behavior; slugify tests pass).

### Tuning (real data)

Plain `word_similarity` let "borges" match "Georges Bataille"; `strict_word_similarity` does not. A whole-query typo threshold of 0.4 let "Peter Nadas" match every "Peter"; per-word matching plus a 0.6 whole-query threshold fixes that and still finds "gabriel garcia markes" and "mishima yukyo".

### Tests

- `src/__tests__/utils/search-text.test.ts`: 13 tests.
- Server functions on the local copy: 41 checks (ranking for accents, word order, typos, both Dostoevsky spellings, noise control, count/map/timeline agreement, filters, sorts, lite search, `findOrCreateAuthor` reuse, library and collection search).
- Headless Chromium on a production build: 9 checks (typing "peter nadas" finds Péter Nádas and keeps focus, "Best match" active, word order, typo, switching to Name sort, library search).
- Live Neon after the migration, read-only with the app's neon-http driver: 10 checks pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (264 tests) pass. `drizzle-kit generate` reports no drift.

### Known limits / follow-up

- A very close multi-word typo can add a near miss at the bottom (for example "stanislaw lem" also lists "Stanislaw Ulam"); the exact match always ranks first.
- Work titles, series, venues and places still use plain `ilike`. Same approach can extend to them.

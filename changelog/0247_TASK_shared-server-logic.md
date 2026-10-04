# Task 0247: Shared Server Logic (SLN-304)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0200 (SLN-281, `uniqueSlug()` in `src/lib/catalogue/slugs.ts`)
**Blocks**: None

## Overview
Several server functions copied the same logic, and the copies could drift.
Each block now exists once. Behaviour does not change.

## Implementation Details

**Library list and count**: `buildWorkConditions(search, filters)` in
`src/lib/actions/works.ts` builds the where clause for `getWorks` and
`getWorkCount`. It returns null when a filter can match no book (no copy at
the location, or no work with a poster). `WorkFilters` types both callers.

**Work detail query**: `getWork(id)` and `getWorkBySlug(slug)` load one
`workDetailWith` relation tree. Only the `where` differs.

**Unique slugs**: the existing `uniqueSlug(table, base, { own, taken })`
helper now also accepts `series`. These copies call it:
- `refreshWorkSlug` (`src/lib/works/slug.ts`), with the work's own slug.
- `createPerson` (`src/lib/actions/people.ts`); the retry and the
  `base-id` last attempt stay.
- `createSeries` (`src/lib/actions/series.ts`); its local `uniqueSlug` is
  gone.
- `src/lib/db/backfill-slugs.ts`, authors and works.

`createTaxonomyFamily` keeps its own copy: taxonomy slugs belong to SLN-303.
Venue slugs carry the row id, so they never needed the check.

**Source parsing**: one `parseYear()` in `src/lib/utils/years.ts` replaces the
copies in `google-books.ts` (anchored at the start) and `isbndb.ts`. Google
Books dates always start with the year, so the result is the same.
`google-books.ts` exports `extractIsbn` and `getBestCover`; Match
(`fromGoogleBooks` in `src/lib/match/source.ts`) uses them instead of its own
ISBN and cover picking.

## Completion Notes
- The issue's `rematchEdition` no longer exists: Match (task 0184) replaced
  it, and Match already uses the full language mapper `normalizeLanguage()`
  (`src/lib/utils/language.ts`). Nothing was left to share there.
- `cleanRecord`'s `year()` in `src/lib/match/source.ts` stays: it is a
  plausibility check (1400 to next year, whole word), not a second parser.
- The slug `like()` patterns stay unescaped: slugify output holds only
  `a-z`, `0-9` and `-`, so `%` and `_` cannot appear. SLN-286 (PR #3) left
  them for this task.
- Open PRs that touch the same files, all merge cleanly with this branch:
  #3, #7, #8, #12, #15, #20, #23, #25.

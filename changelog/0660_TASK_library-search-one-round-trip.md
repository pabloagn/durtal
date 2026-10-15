# Task 0660: Library search in one round trip

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-750. This was finding 2 of the second loading and speed audit (`findings/audit-loading-2-2026-10-15.md`).

Before, a search in the library ran up to four lookups, one after another, before the list and its count could start:
1. the ISBN, for a query with four or more digits;
2. the author;
3. the edition's publisher text;
4. the publisher record and its aliases.

Each lookup only collected work ids for the list's where clause. Each one cost a round trip to the database.

## Implementation Details

- `buildSearchCondition` (`src/lib/actions/works.ts`) builds every related-table match as a subquery of the list's own where clause (`works.id in (select …)`). It sends no query of its own.
  - The matches are the same as before:
    - title;
    - series name or series record;
    - author (accents, case and word order aside);
    - ISBN (whole, hyphenated or partial);
    - publisher text;
    - publisher record or alias.
  - A whole ISBN still finds its book alone.
- It no longer needs React's per-request `cache`, which only saved the list and the count from running the lookups twice.
- No migration.

## Completion Notes

- **Test** (`integration/library-filters.test.ts`): it checks that a search matches:
  - by title and series, author, whole, hyphenated and partial ISBN, publisher text, publisher record and alias;
  - with the list and its count agreeing;
  - with no query beyond those of an unsearched list.
  - Run against main's code, every result expectation passed and only the query count failed. So the results are unchanged.
- **Timing** (seeded production preview; every database round trip held 800 ms by the preview bridge, audit-only and not committed):
  - The `/library?q=borges` page went from 3.25 s and 4 round trips (the three lookups, then the list and its count) to 0.84 s and 1 round trip.
  - Typing the search into the library's field, until the results arrived, went from 3.6 s to 1.2 s, the same in Chromium, Firefox and WebKit.
- **Page weight:** every route is within budget (`/library` 195 of 300 KB).
- `pnpm typecheck` is clean, and ESLint on the changed files is clean.

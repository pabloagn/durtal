# Task 0666: The Films list reads its count and its page together

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-790. The film home read the number of matching films first, then the page of films, then the page's cards: three database round trips after the page's own count of the catalogue. The count went first so that a page past the end could go to the last page before reading it.

## Implementation Details

- `getFilmPage` (`src/lib/actions/films.ts`) returns one page of films and how many match:
  - By title (the default sort): the alphabetical order already reads every match's id and title, so the same read gives the count (`alphabeticalWorkPage` in `utils/alphabetical-works.ts`; `alphabeticalWorkIds` now calls it).
  - By release, runtime, date added or rating: the count and the page's ids go together through `readTogether`.
  - A page past the end comes back empty, with the count. The page still redirects to the last page; it now does so after the read instead of before it.
  - An offset past what the list reads (1,000,000) skips the ids and reads only the count, so a very large page number still redirects instead of failing.
- `readTogether` (`src/lib/db/read-together.ts`) sends reads in one request with `db.batch` on Neon's HTTP driver. Without `batch` (a local Postgres in tests) it runs them side by side, not in a transaction as `atomic` does.
- `getFilms` and `getFilmCount` keep their behaviour; they share the count and page queries with `getFilmPage`.
- No migration and no new package.

## Completion Notes

- **Timing** on the seeded production preview, each database request held for the given time (audit-only, not committed); median of 7 loads.

  | `/films` | 40 ms | 200 ms | 800 ms | Waves |
  | --- | --- | --- | --- | --- |
  | Title, main | 0.21 s | 0.84 s | 3.24 s | 4 |
  | Title, this change | 0.16 s | 0.64 s | 2.43 s | 3 |
  | Release, main | 0.20 s | 0.84 s | 3.25 s | 4 |
  | Release, one batch | 0.16 s | 0.64 s | 2.44 s | 3 |
  | Release, two reads side by side | 0.16 s | 0.64 s | 2.44 s | 3 |

  - A batch runs its reads one after another on the database side (the #370 review), so it was timed against sending the two reads side by side. With two cheap reads they tie at every latency, and the batch sends one request instead of two, so the batch stays.
  - The page reads the same: its text matches main's.
- **Past the end:** `?page=9`, `?sort=release&page=50000`, and `?sort=rating&order=asc&page=2&perPage=24` go to the last page, keeping the sort and page size. A search with no results shows its empty state at any page.
- **Tests:**
  - `db/read-together.test.ts`: one batch when the driver has one; side by side, outside a transaction, when it has none; nothing sent for no reads; a failure passes through.
  - `integration/domain-search.test.ts`: for every sort, `getFilmPage` gives the same pages as `getFilms` and the same count as `getFilmCount`; a page past the end, and an offset past 1,000,000, come back empty with the count.
- **Page weight:** every route is within budget (`/films` 91 of 300 KB).
- `pnpm typecheck` is clean, and ESLint on the changed files is clean.

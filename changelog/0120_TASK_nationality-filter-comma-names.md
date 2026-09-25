# Task 0120: Nationality Filter Fails for Country Names With Commas

**Status**: Completed
**Created**: 2026-09-24
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: 0121

## Overview

`/authors?nationality=Hungary%2C%20Republic%20of` shows no authors, even though Hungarian authors exist (for example Péter Nádas). Every country whose name contains a comma ("X, Republic of" style) is affected.

## Implementation Details

### Root cause (confirmed in code)

- The multi-value filter is stored as one comma-joined URL param:
  - Server: `src/app/authors/page.tsx:63` does `searchParams.nationality?.split(",")`.
  - Client: `src/app/authors/authors-shell.tsx:247` splits the same way; `:392` writes `values.join(",")`.
- `"Hungary, Republic of"` becomes `["Hungary", " Republic of"]` (no trim), so the exact `inArray(countries.name, ...)` match in `src/lib/actions/utils/author-filters.ts:26-37` finds nothing and returns an empty list.
- The dropdown options come from `getDistinctNationalities` (`authors.ts:171-177`), so picking the country from the UI breaks too.
- The same broken filter feeds the map and timeline views (`page.tsx:90, 109-110`).
- The empty result then triggers the "search bar disappears" bug (task 0118).

### Fix direction

- Filter by a stable key that cannot contain the delimiter: the country ISO code (`alpha_2` / `alpha_3`) or id, not the display name. Alternatively, use repeated params (`?nationality=A&nationality=B`, read with `getAll`).
- Check every other comma-joined multi-value filter on `/authors`, `/library` and `/places` for the same problem.
- Add a test with a comma-containing country name.

## Completion Notes

The filter was broken for far more than Hungary: 58 of the 72 countries in use have a comma in their name (931 of 1,948 authors with a nationality). The author detail page link had the same bug.

### Fix

- The `nationality` URL param now holds ISO 3166-1 alpha-2 codes (`/authors?nationality=HU,FR`). Codes never contain the delimiter.
- New pure helper `src/lib/utils/nationality-param.ts`:
  - `parseNationalityCodes()`: split, trim, uppercase, dedupe. Returns `null` for old name-based values.
  - `formatNationalityParam()` and `nationalityFilterHref()`: build the param and the link.
  - `resolveLegacyNationalityNames()`: rebuilds old comma names into codes (longest name match wins).
- `getDistinctNationalities()` returns `{ code, name }[]`. The dropdown uses the code as value and the name as label.
- `buildAuthorFilterConditions()` resolves codes through `countries.alpha_2`. Grid, list, table, map and timeline all use it.
- `/authors` redirects old name URLs to the code format, so old bookmarks still work (`?nationality=Hungary%2C%20Republic%20of` -> `?nationality=HU`).
- Author detail header links with the code. `getAuthorBySlug()` now also loads `country.alpha2`.

### Other multi-value filters checked

- `/library` (`status`, `priority`, `rating`, `poster`) and `/places` (`type`) use fixed enum values with no comma. Not affected.

### Tests

- `src/__tests__/utils/nationality-param.test.ts`: 21 tests (comma names, the exact reported URL, longest match, case, spaces, dedupe, round trip).
- Local copy of the live DB: all 72 countries return the same author count as SQL. HU + FR returns 246 (24 + 222). List, count and map agree. Timeline shows only authors with a birth year.
- Browser: old URL redirect, dropdown checked state, multi-select, detail page link, map view.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (215 tests) pass.

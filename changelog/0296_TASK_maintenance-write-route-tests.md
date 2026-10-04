# Task 0296: Tests for the slug refresh and reader progress routes

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0295
**Blocks**: None

## Overview

Part of SLN-311. Task 0295 tested the REST write routes for orders, copies,
works and editions. This task tests the two write routes that no suite and no
open pull request covers: `POST /api/works/refresh-slugs` and the reader's
progress (`GET` and `POST /api/reader/[calibreId]/progress`).

## Implementation Details

`src/__tests__/integration/maintenance-write-routes.test.ts`
(`DURTAL_MAINTENANCE_ROUTES_TEST_DATABASE_URL`, `/sln311_maintenance_routes`),
10 tests:

- Slug refresh: 401 without the token or with a wrong one, 503 without
  `DURTAL_API_TOKEN`; `dryRun=1` lists the change and writes nothing; a stale
  slug gets the one it should have, a fitting one stays, and a second run
  changes nothing; `id` limits the run to one work, an invalid one is 400;
  the slugs of other collections (a film) stay.
- Reader progress: no progress before the first read; a save stores the
  position (the page rounded), and a later save changes only the fields it
  sends; page, percent, CFI and chapter stay inside their limits; fields of
  the wrong type are ignored; 400 for a bad id, no JSON or a null body, 404
  for an unknown book, and nothing is written.

No route changed: the tests found no bug.

## Completion Notes

Left out on purpose: the collection routes (pull request #54 changes them,
and `collections-api-route.test.ts` covers them); comments, media, S3,
export and authors (pull requests #68 and #73 change them); apply-crops and
backfill-palettes (they need S3; `admin-token.test.ts` covers their guard);
search-places (it calls Google).

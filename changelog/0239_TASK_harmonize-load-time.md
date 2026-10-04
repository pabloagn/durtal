# Task 0239: Harmonize loads faster and sends one page of findings

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-383. `/harmonize` read every column of 33 tables as one JSON value,
scanned it with list searches inside loops, and sent all 4,422 findings to
the browser. The page took 1.7 s and sent 3.6 MB of HTML.

## Implementation Details

- `src/lib/harmonization/registry.ts`: `SCAN_COLUMNS` lists the columns the
  rules, `recordRef` and the fingerprints read. `isReady` and `DEFAULT_QUERY`
  are shared by the server action and the page.
- `src/lib/harmonization/store.ts`: `loadDataset` selects only the scan
  columns that a table has, as row arrays, and rebuilds the row objects in
  Node. Tables with an `id` sort by `id`. With a C collation and "id" as the
  shortest key, this is the old `to_jsonb(r)::text` order. Tables without an
  `id` keep the old order. `_filled` counts the non-blank columns of the full
  row in SQL, so `preferredRecord` picks the same record as before.
  `scannedRowsSql` gives the same rows for the series assertion in an apply.
- `src/lib/harmonization/engine.ts`: `rowsBy` groups a table by one column
  once per dataset, in table order. It replaces the list searches for works,
  editions, media and work authors. A set of the records in duplicate
  findings replaces a search over all findings for each author.
- `src/lib/actions/harmonization.ts`: `scanLibrary(query)` filters on the
  server and returns the first page, the totals, the counts and the first 20
  ready fixes. The decisions and history queries run beside the data load.
  An apply compares the scan columns of the record, not the full row.
- `src/app/harmonize/workspace.tsx`: the filters, search and "Show 60 more"
  ask the server for the matching page. Only the latest request updates the
  page. A dismiss or restore reloads the page and its counts.

## Completion Notes

Measured with live data (4,381 findings), on this Mac with other sessions
running:

| | Before | After |
|---|---|---|
| `/harmonize`, production build | 1.70 s, 3,636 KB (from SLN-383) | 0.40–0.56 s, 365 KB |
| `loadDataset()` | ~1.4 s, 7.1 MB | ~0.34 s, 2.9 MB |
| `scanDataset()` | ~0.22 s | ~0.07 s |

The HTML is 365 KB, and 52 KB of it is the scan. `/settings` is 295 KB in
the same build: the app shell (168 KB of inline CSS and the shared scripts)
is most of the page. The 300 KB and 400 ms targets of the issue are not met
in full. The rest of the server time is the database round trip from this
Mac to Neon.

All 4,381 finding keys, fingerprints and recommended records are identical
on `main` and on this branch. `_filled` matches the old count on all 6,980
rows. The integration test for dismissals now reads the dismissed view: a
dismissed finding is no longer in the inbox list.

Checks: typecheck, lint, the DB suite (1,488 of 1,488 tests) and the
alignment audit on `/harmonize` (0 issues). The design audit lists only the
decorative separator, title dot and section numbers, which this change
does not touch. Filters, search and "Show 60 more" were checked in the
browser on the production build. Dismiss and apply were not run on live
data; the DB suite covers them.

Not done: an apply still loads the full dataset (fix 3 of the issue). It is
now about 3 times faster.

# Task 0935: Harmonize scans once

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-887. /harmonize took 2.1 s at 200 ms on the 5,000-book seed (`findings/scale-recheck-2026-10-18.md`): one large dataset query, then about 1.4 s of `scanDataset()`. Every search pause and filter change ran the whole load and scan again.

## Implementation Details

- `lib/actions/harmonization.ts`: `scanLibrary` keeps the last full scan of the server process. A request that names the scan the page shows (`of`, the new `Scan.scanId`) is filtered from it in memory: no dataset query and no scan. Opening the page, Scan library and every action scan afresh, as before. A scan the process no longer holds is scanned again.
- `app/(catalogue)/harmonize/workspace.tsx`: a search or filter change sends `of` with the page's scan; Scan library and the actions don't.
- `lib/harmonization/store.ts`: the scan loads only the images it reads, of book works, book people and collections. A film's, perfume's, painting's, publisher's or object's images are left out.
- `lib/harmonization/engine.ts`:
  - A finding's fingerprint, a SHA-256 of its rule, evidence, records and resolution, is worked out on first read: for the findings a page shows or a decision names. It is the same hash as before, so stored dismissals still match.
  - Names and texts are normalized once per scan.
  - Duplicate buckets are keyed by group, then by key, without a joined string per key.
- `lib/harmonization/normalize.ts`: `stableStringify` sorts each object shape's keys once, in the same `localeCompare` order.

## Completion Notes

- On the 5,000-book dataset (19,151 findings), in Vitest with the database mocked: `scanDataset` went from about 650 ms to about 350 ms; a search answered from the last scan takes about 20 ms.
- JIT, checked for the Linear note: on the 5,006-work scale fixture (`scripts/qa/fixtures/hot-join-indexes-scale.sql`) in PostgreSQL 16, the dataset query plans at a cost of about 5,500, far under `jit_above_cost` (100,000), and runs in 120 to 130 ms; JIT never starts, and the read timed the same with it off (230 to 350 ms either way). So `loadDataset` is left as it is.
- `ui/harmonize-times.test.ts` (on main since) gains the scan's `scanId`.
- Tests: `integration/harmonization.test.ts` (a search answered from the page's scan, a fresh scan without `of`, a scan no longer held) and `integration/domain-harmonization.test.ts` (only a book's images are loaded). The existing dismissal test checks that the fingerprints still match.
- Browser, in Chromium, Firefox and WebKit on a seeded preview: typing in Harmonize's search sends one request naming the page's scan, the findings filter, and "Scanned" keeps its time. The alignment and design audits are clean on /harmonize at 1440 and 390, and page weight passes on every route.

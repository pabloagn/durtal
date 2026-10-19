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
- JIT (the Linear note; the Seventh reviewer's EXPLAIN in `findings/harmonize-loaddataset-explain.txt`). With 1,200 films, perfumes and paintings, the dataset query planned past `jit_above_cost` (100,000), because each of those works looked up its makers, its houses and its links on its own. The work-first index existed, but the planner took the role-first one. The JIT compile then cost more than the read: the reviewer measured 789 ms with it and 413 ms without.
- `lib/harmonization/store.ts`: the films', perfumes' and paintings' makers, houses and links are each grouped once and joined by work, instead of looked up per work. On the 5,006-book scale fixture with 1,200 such works added (PostgreSQL 16, ANALYZE), the plan's cost fell from 42,379 to 6,404. The output is the same: 1,206 works, 1,200 with makers, 101 with links. A work's links are now in id order. No database or role setting is touched, and no `set local` is needed.
- `ui/harmonize-times.test.ts` (on main since) gains the scan's `scanId`.
- Tests: `integration/harmonization.test.ts` (a search answered from the page's scan, a fresh scan without `of`, a scan no longer held) and `integration/domain-harmonization.test.ts` (only a book's images are loaded). The existing dismissal test checks that the fingerprints still match.
- Browser, in Chromium, Firefox and WebKit on a seeded preview: typing in Harmonize's search sends one request naming the page's scan, the findings filter, and "Scanned" keeps its time. The alignment and design audits are clean on /harmonize at 1440 and 390, and page weight passes on every route.

# Task 0613: Record pages check their record once before the loading screen

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0610
**Blocks**: None

## Overview

From the loading, empty and error states audit of 15 October
(`findings/audit-loading-2026-10-15.md`, finding 2). A click on a link that
was not prefetched showed nothing for a long time.

The audit put this down to the catalogue layout's settings read. It is not
the cause. Measured with the database slowed to 800 ms a query:
- The settings and image adjustments reads are served from the data cache.
  The collections and Harmonize loading screens show within 130 to 280 ms.
- A record page's own layout makes three round trips in a row before its
  loading screen:
  - whether the harmonization tables exist;
  - the merged-record redirect;
  - whether the record exists.

## Implementation Details

- **`liveRecord`** (`src/lib/harmonization/redirect.ts`) checks the record
  first. Only when it is missing does it look for a merged-record redirect, and
  follow it. A redirect never applies to a live record, since its query only
  matches when no live record has that id or slug, so the outcome is the same
  as before. A live record costs one query before its loading screen.
- It is the check of the record layouts of:
  - books, films, perfumes and paintings;
  - people and publishers;
  - places.
- **`persistenceAvailable`** (`src/lib/harmonization/store.ts`) keeps a yes for
  the process's life. The migration's tables and guard do not go away once
  made. A no is asked again, so a migration run later is seen.
- The catalogue layout keeps its settings read. It costs a round trip only on
  the first request after a restart or a settings save. There is no progress
  bar.

## Completion Notes

- Unprefetched clicks from Settings, database at 800 ms a query, at 1440.
  Times are until the loading screen shows; before is main at e1bde5cd.

  | Page | Before (Chromium / Firefox / WebKit) | After |
  | --- | --- | --- |
  | A book | 2.64 / 2.53 / 2.55 s | 0.99 / 0.93 / 0.93 s |
  | A person | 2.51 / 2.49 / 2.49 s | 0.89 / 0.89 / 0.86 s |
  | A publisher | 2.51 / 2.52 / 2.52 s | 0.91 / 0.91 / 0.90 s |
  | A film | 2.55 / 2.52 / 2.48 s | 0.93 / 0.89 / 0.88 s |
  | A perfume | 2.54 / 2.53 / 2.49 s | 0.92 / 0.90 / 0.89 s |
  | A place | 1.70 / 1.73 / 1.73 s | 0.88 / 0.90 / 0.95 s |
  | An eBook (unchanged) | 0.89 / 0.89 / 0.87 s | 0.87 / 0.88 / 0.89 s |

- Production preview:
  - A missing book, person, publisher, film, perfume, painting and place
    answers 404.
  - A merged person's and a merged book's old address redirect (307) to the
    record they were merged into.
- `src/__tests__/integration/harmonization.test.ts`: a live record opens with
  its one check and no redirect query, a merged one redirects, and a missing
  one is not live. The harmonization, record check and 404 suites pass on a
  disposable database.
- Page weight: 39 routes within budget, 5 skipped with nothing to measure.

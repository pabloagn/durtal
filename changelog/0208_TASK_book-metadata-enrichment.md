# Task 0208: Book metadata cleanup and enrichment (code half)

**Status**: In Progress
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-414. A guarded, reviewable run that fills empty book metadata from ISBNdb
and Open Library: edition description, page count, publication year and
binding, and a work's description when it has none. `editions.language` is
NOT NULL with the default 'en', so it is never empty: a run only reports a
language that differs, and never changes it. Values that differ
from what the catalogue holds are reported, never changed. This task builds
the code. The live plan run and any write wait for the owner.

## Implementation Details

- `src/lib/books/enrichment.ts`: pure rules. `planEdition` skips locked
  editions, `phantom_canon` placeholders and editions with no ISBN. A source
  counts only with the exact ISBN and an agreeing title. Only empty columns
  are filled. A field is held when the two sources disagree or the value is
  implausible (pages 16 to 3000, year 1450 to next year, description of 80
  characters or more). Two page counts within 5% give the lower one. The
  publisher is report-only (an empty one goes to the publisher name inbox).
  `editionUpdate` throws on any column outside `EDITION_FILL_COLUMNS`; ISBNs,
  publisher, imprint, publisher links and every image are never written.
  `suspectOriginalYear` flags works whose original year equals or follows an
  edition year.
- `src/lib/books/enrichment-store.ts`: `loadEnrichableEditions`,
  `applyEditionPlan` (each column only while it is still empty, plus one
  `source_records` row per source used, with the run id in the payload),
  `undoEnrichment` (clears a value only while it still holds the run's value,
  then removes the run's provenance) and `assessBookMetadata` (read-only).
- `scripts/books/enrich.ts`: `--assess` (read-only), plan (default; paced,
  cached source calls, read-only transaction, markdown report),
  `--apply --backup FILE` (refuses without a pg_dump custom-format backup
  written in the last hour; creates the undo file, named after the run,
  before the write, so a missing folder or an existing file stops the run
  first, and fills it right after the commit) and `--undo FILE`.
- No migration: the run uses the existing `source_records` table and an undo
  file, as the publisher and author enrichment do. The publisher identity
  trigger never fires, since publisher, imprint and ISBN are never written.

## Completion Notes

- Tests: 15 unit tests (`src/__tests__/books/book-enrichment.test.ts`) and a
  DB suite (`src/__tests__/integration/book-enrichment.test.ts`,
  `DURTAL_BOOK_ENRICHMENT_TEST_DATABASE_URL`, `/sln414_test`). Full local
  suite: 132 files, 1630 tests passed.
- Live `--assess` (read-only), 2026-10-04: 680 book editions, 198
  placeholders, 203 without an ISBN, 624 without a description, 138 without
  a page count, 119 without a year, 635 without a binding, 155 works without
  a description, 420 works whose original year looks like an edition year.
- Waits for the owner: check the ISBNdb plan quota, run the plan and review
  the report, take a backup, then give the go for `--apply`. Fixing the
  suspect original years is a separate, manual review.

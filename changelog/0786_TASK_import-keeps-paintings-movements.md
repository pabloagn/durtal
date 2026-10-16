# Task 0786: Importing an export keeps every painting

**Status**: Completed
**Created**: 2026-10-16
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

From the Third reviewer's import and export survey of 16 Oct. A painting
keeps its art movements in `work_art_movements`, the same table as a book's,
and the interchange export writes them in the painting's record. The
importer allowed that table on book records only, so it refused every
painting with a movement ("a painting record cannot carry it"): 30 of 148
records in the survey's export. Restoring a backup that way would have lost
those paintings.

## Implementation Details

- `src/lib/interchange/tables.ts`: `work_art_movements` is carried by book
  and painting records. No other table a non-book kind writes was limited to
  books (checked against the painting, film and perfume writers).
- No change to the file format's columns or version: the export already
  wrote these rows.

## Completion Notes

- `integration/interchange.test.ts`: the mixed library's painting now has an
  art movement, so the round trip (export, empty the catalogue, import, then
  the same table counts and the same export again) covers it. Without the
  fix the painting fails to import and the test fails; with it, it passes.
- `interchange/format.test.ts`: a painting record and a book record read
  their movements; a film record is still refused one. Fails without the fix.
- No migration and no new packages.


## SLN-954 recovery completion — 16 October 2026

- Recovered the existing implementation from Claude commit `c3f8361f`; its original reference to SLN-894 is corrected here to SLN-954.
- Added an explicit fixture covering every taxonomy table and all four work kinds, including book/edition custom terms, perfume formulation notes and terms, and painting object classifications. Coverage is pinned independently of the importer's domain allowlist.
- Every exported record passes `readRecord`; all three dry-run policies leave the populated database unchanged. An empty-database dry run writes nothing, and an actual disposable restore reproduces every table count and the canonical export exactly.
- Typecheck and scoped `test:local` pass: 23 tests, zero skipped; all Python preflight tests pass; the disposable container is removed. No live export/import, migration, catalogue write or new dependency.

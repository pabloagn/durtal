# Task 0403: Correct the enrichment, monochrome audit and import review findings

**Status**: Completed
**Created**: 2026-10-08
**Priority**: High
**Type**: Fix
**Linear**: SLN-414, SLN-422, SLN-450

## Changes

- Book enrichment requires full catalogue/provider author agreement, including co-authors. ISBNdb names and paced Open Library author lookups supply the evidence; old cached records without authors are refreshed. Under a transaction lock, apply rechecks the edition lock, placeholder status, ISBNs, titles, work and authors before writing.
- The monochrome audit compares visible pixels individually with a one-level RGB tolerance. Balanced red/cyan pixels can no longer pass as grey. Transparent pixels are ignored only when fully transparent.
- Reading imports journal rating undo data with the reading/rating transaction and identifier undo ids with the identifier insert. A lost response or failed summary cannot discard that journal. Retries preserve it; undo restores only unchanged ratings. Partially journaled rows keep their book and decisions until undone.

## Verification

Regression tests reproduce the previous failures. The final focused run passes 65 tests with 0 skipped. App typecheck, a separate enrichment-script typecheck, and lint pass (0 errors; 75 existing warnings). The production webpack build passes. The full suite passes 3,156 tests across 290 files with 0 skipped, plus all three Python test files. Disposable containers were removed. The final focused run also verifies the additional interrupted-row editing guard. All database tests use disposable local PostgreSQL; image tests use an in-memory bucket.

The live metadata fill, existing-image conversion and seed-spreadsheet import remain separate pending operations. This change does not run them.

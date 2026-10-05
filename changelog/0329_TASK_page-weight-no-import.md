# Task 0329: Page weight skips the import preview before the first import

**Status**: Completed
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0307 (SLN-450)
**Blocks**: None

## Overview

SLN-479. `scripts/qa/page-weight.json` gained the row `/reading/import/*` in
task 0307. `page-weight.js` measures a `/*` row on the first link under that
path on its list page, and failed the row with "no link found on
/reading/import" when no reading import exists. The live database has none
yet, so the check failed for every front-end change.

## Implementation Details

- `scripts/qa/page-weight.js`: a `/*` row with an `ifNone` note and no link
  on its list page prints `skip  /reading/import/*  skipped: no import (no
  link on /reading/import)` and does not fail the run; the run ends with "1
  of 21 routes skipped: nothing to measure yet". With a link, the row is
  measured as before. A `/*` row without the note still fails when it finds
  no link. `PAGE_WEIGHT_CONFIG` names another budget file, for the test.
- `scripts/qa/page-weight.json`: the `/reading/import/*` row has
  `"ifNone": "no import"`; no other row has one.

## Completion Notes

- Test `src/__tests__/qa/page-weight.test.ts` runs the script against a small
  local server: a row with the note and no link is skipped and the run
  passes; the same row with a link is measured; a row with no note and no
  link fails; only the import row has the note.

# Task 1133: The browser journeys match the app again

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

`scripts/qa/journeys.mjs` failed on main where the app's wording had changed under it, so the cloud gates' paintings journey and the books journey failed on every branch.

## Implementation Details

- Paintings: the title field's placeholder is "e.g. The Night Watch".
- Sentence case: "Delete work", "Add edition", "Create order", "On order"; the add-publisher page's button is "Add publisher"; a new copy says "Copy added"; a copy's location reads "Study, physical".
- `orderStatus(title, status)` sets an order's status from its pipeline panel.
- The books journey now deletes only its first book. The wanted book's delivered order is its acquisition record, so its delete is refused until the order is Returned, and a delivered order leaves the pipeline, the only place to change it (SLN-1507).

## Completion Notes

Against a production preview on a disposable database: perfumes, films, paintings, collect, kinds and books all pass.

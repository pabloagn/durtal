# Task 0117: Wizard "Skip Copies" Still Creates an Amsterdam Copy

**Status**: Completed
**Created**: 2026-09-24
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

In the add-book wizard (`/library/new`), choosing "Skip copies" still creates an instance at Amsterdam. Skipping copies means the book is not owned yet, so no instance must be created. This corrupts derived ownership.

## Implementation Details

### Current behavior (confirmed in code)

- `src/app/library/new/wizard.tsx`:
  - Edition step "Skip copies" (~982-986) only calls `setStep("categorize")`. It shows only when `isWishlistStatus` (~169) is true.
  - Instance step has a second Skip (~1050), shown only when no draft has a location.
  - `instanceDrafts` (~185-187) starts as `[{...EMPTY_INSTANCE}]`. There is no skip flag.
  - The reference-data effect (~229-292) runs on the `instance`, `categorize` and `confirm` steps. At ~259-274 it auto-assigns the first "preferred" location (`["amsterdam", "mexico city"]`) to every draft without one.
  - `handleSubmit` (~365-480) creates an instance for every draft with a `locationId` (~434).

### Root cause

Skipping to `categorize` still triggers the auto-fill effect, which gives the untouched default draft the Amsterdam location. Submit then creates it, because only `locationId` gates creation. The same auto-fill also hides the instance-step Skip button (a draft always has a location), and the confirm step lists the phantom copy (~1227-1235).

### Fix direction

- Add an explicit `skipCopies` state (or clear `instanceDrafts` on skip) and honor it in `handleSubmit` and the confirm summary.
- Only auto-fill a default location when the user is on the `instance` step, never on later steps.
- Verify the confirm step shows "No copies" when skipped, and that the created work has zero instances.

## Completion Notes

Root cause confirmed and reproduced end to end: with the old code, "Skip copies" on a "wanted" book created a copy at Amsterdam.

### Fix (`src/app/library/new/wizard.tsx`)

- New `skipCopies` state. Set by "Skip copies" on the edition step and on the copies step. Cleared by "Add copies", by "Categorize" on the copies step, and by the confirm page's "Edit" for copies.
- New pure helpers in `src/lib/utils/instance-drafts.ts`:
  - `draftsToCreate(drafts, skipCopies)`: the copies submit creates. Submit and the confirm summary both use it, so they always agree.
  - `pickDefaultLocationId(locations)`: Amsterdam, then Mexico City, then the first location (same order as before).
- The default location is now filled in only on the copies step. The reference-data effect only stores it.
- The copies step always shows "Skip copies" (the auto-fill used to hide it).
- "Back" from categorize goes to the edition step when copies were skipped.

### Data check (live DB, read-only)

No book with a wish-list status (`tracked`, `shortlisted`, `wanted`) has an Amsterdam copy. All 75 copies on wish-list books are Calibre (digital) copies. `createInstance` does not change the work status, so no affected book was hidden as "accessioned". Nothing to clean up.

### Tests

- `src/__tests__/utils/instance-drafts.test.ts`: 8 tests.
- Headless Chromium against a production build on the local DB copy, 13 checks, all pass, with SQL checks on the created rows:
  - "wanted" + "Skip copies": confirm shows 0 copies; work saved with 0 copies;
  - "Add copies anyway" (Amsterdam pre-selected, Skip visible) then "Skip copies"; Back returns to the edition step; 0 copies;
  - "accessioned" + "Add copies": no Skip on the edition step; 1 copy at Amsterdam;
  - skip, then "Edit" copies on the confirm page: 1 copy.
- The same test against the old code fails (1 Amsterdam copy after "Skip copies"), so it catches the bug.
- Test rows were removed from the local copy afterwards.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass.

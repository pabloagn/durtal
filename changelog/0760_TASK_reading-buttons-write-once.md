# Task 0760: Save anyway, Pause instead and Undo write once

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-812, from the third loading and error states survey
(`findings/survey-loading-3-2026-10-15.md`, items 1 and 7). Three buttons
that write stayed live while their write ran:
- "Save anyway" in Log a past read had no busy state, and the dialog's
  `submit` had no guard. Both writes carry `allowPossibleDuplicate`, so a
  double press could log the same read twice.
- "Pause instead" in Abandon had no busy state, and it stayed live while
  Abandon saved, and the other way round. The reading's fingerprint turned the
  second write into an error toast.
- Undo in Hidden suggestions had no busy state, so a double press ran the
  removal twice.

## Implementation Details

- **`past-read-dialog.tsx`**:
  - An `inFlight` ref lets one save run at a time.
  - "Save anyway" is `busy` while it runs, as "Log read" already was.
- **`abandon-reading-dialog.tsx`**:
  - Abandon and Pause instead share one `inFlight` ref.
  - Pause instead is `busy` while it pauses, and disabled while Abandon saves.
  - Abandon is disabled while Pause instead runs.
- **`hidden-list.tsx`**:
  - A row's Undo is `busy` from the press until the refresh takes the row
    away. Only that row waits.
  - The row is freed if the write fails or finds nothing to remove.
  - It is also freed once it leaves the list, so a row brought back by the
    toast's Undo can be pressed again.
- **Test**: `src/__tests__/ui/reading-one-write.test.ts`. Four of its five
  cases fail without the change.

## Completion Notes

- Typecheck is clean, and lint reports nothing on the three files.
- The reading dialog tests pass.
- No migration, no new package.

# Task 0358: SLN-521 A merge test after a finish waits for the history entries

**Status**: Completed
**Created**: 2026-10-07
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

`src/__tests__/integration/reading.test.ts`, "blocks a merge of two books
both being read, and moves readings otherwise", failed once in the merge
train with "The records or their relationships changed" from
`executeMerge`. The cause is in the test, not the app:

1. `recordActivity` (`src/lib/activity/record.ts`) writes a history entry
   after the action returns. `finishReading` records
   `work.reading_finished` that way.
2. A works merge's fingerprint covers the two works' `activity_events`.
3. The test took the preview at once. Under load, the entry landed between
   the preview and the execute, and the execute saw a changed snapshot.

A person cannot hit this: the preview is a later page load, after the entry
has landed. If an entry does land between the two, the merge refuses and
asks for a fresh preview, as it should.

## Implementation Details

- `recordActivity` keeps the writes in flight in a set, and the new
  `activitySettled()` resolves once every write started so far has landed.
  The fire-and-forget behaviour is unchanged.
- In `reading.test.ts`, `settle` was a 60 ms sleep that guessed when the
  entries had landed. It is now `activitySettled`. The merge test calls it
  before the preview.
- `src/__tests__/activity/settled.test.ts`: `activitySettled` waits for
  writes held open, and resolves at once with none in flight.

## Completion Notes

- Reproduced with the activity writes held 200 ms (a temporary patch, not
  committed). Without a wait before the preview, the merge test fails with
  "The records or their relationships changed". With the wait, all 36
  tests pass. The two history tests that relied on the 60 ms sleep failed
  under the delay before this change, and pass with it.
- `reading.test.ts` passes 3 runs out of 3 without the delay.
- `pnpm test`: 161 files pass, 79 database suites skipped.
  `test-local.py`: 240 files, 2,649 tests pass. Typecheck is clean; lint
  has 0 errors.

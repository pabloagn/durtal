# Task 0967: A retry clears the failed check, so an upload run counts only the last one

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0964
**Blocks**: None

## Overview
An upload whose check failed, was retried and then passed kept its old failure note. If the file was then canceled, its run settled as "failed" although nothing had failed in the end (SLN-1466).

## Implementation Details
- `src/lib/ebooks/upload-core/commands.ts`: the retry command, the one place a new check of the same file starts, removes `jobFailureV1` from the file's progress in the same write that bumps its generation, and the receipt check asserts the cleared progress.
- `src/lib/ebooks/upload-core/run-settle.ts`: unchanged rule, now with a comment: a canceled file with a `jobFailureV1` note makes its run "failed". A first version matched the note's generation to the file's instead; review found that recovery at every service start (`beginRecovery`) bumps the generation of files it still holds, so a failure followed by a restart and a cancel would have settled "finished".
- `src/lib/ebooks/upload-core/store.ts`: `recordedJobFailure` reads the note without the generation match, for the same reason, so a failed file keeps its reason after a restart.
- Tests:
  - `upload-run-settle.test.ts`: fail, retry and pass, then cancel settles "finished"; fail, retry and fail again, then cancel settles "failed"; fail, restart, then cancel settles "failed".
  - `retry-clears-failure.test.ts` (new): the retry's write drops the note, keeps the rest of the progress, and its receipt check asserts the same.
  - `item-refusal.test.ts`: a failed file keeps its reason after a restart.

## Completion Notes
No migration. A file retried before this change keeps its old note, so canceling it still marks the run failed, as before; nothing is cleaned in place. Each new test fails with its change taken out.

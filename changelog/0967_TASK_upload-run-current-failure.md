# Task 0967: An upload run counts only the current check's failure

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0964
**Blocks**: None

## Overview
An upload whose check failed, was retried and then passed kept its old failure note. If the file was then canceled, its run settled as "failed" although nothing had failed in the end (SLN-1466).

## Implementation Details
- `src/lib/ebooks/upload-core/run-settle.ts`: a canceled file makes the run "failed" only when its `jobFailureV1.generation` equals the file's current `generation`. Each claim of a check bumps the generation (`claimNext`), so a failure from an earlier attempt no longer counts. The comparison is done as jsonb (`to_jsonb(u.generation)`), so a malformed note can't make the settle statement throw. This is the same rule the item view already uses (`recordedJobFailure` in `upload-core/store.ts`).
- `src/__tests__/integration/upload-run-settle.test.ts`: fail, retry and pass, then cancel settles "finished"; fail, retry and fail again, then cancel settles "failed".

## Completion Notes
No migration. The new test fails against main's settle statement (the run settles "failed") and passes with the fix.

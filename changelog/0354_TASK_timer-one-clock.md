# Task 0354: SLN-519 The reading timer reads one clock

**Status**: Completed
**Created**: 2026-10-06
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0311 (SLN-451)
**Blocks**: None

## Overview

The reading timer (SLN-451) read two clocks. The pause stored the app's
time in `paused_at`, and the resume took `floor(now() - paused_at)` with
Postgres's `now()`. A database clock a few milliseconds behind the app's
cut each pause short by a second. The start, the stop, the discard and the
elapsed time already read the app's clock. The reading-sessions database
test "runs one at a time across the app" failed with "expected 299 to be
greater than or equal to 300". It was found by the full suite for SLN-410.

## Implementation Details

- `resumeTimerRow` (`src/lib/reading/timer-service.ts`) passes the app's
  now into the same atomic SQL: `floor(<app now> - paused_at)`, capped at a
  day as before. Every timer step now reads the app's clock. The module's
  comment says so.
- `src/__tests__/integration/reading-sessions.test.ts`:
  - The test pauses at a fixed app time (`vi.useFakeTimers({ toFake: ["Date"] })`) and resumes exactly 5 minutes later. It expects exactly 300 seconds, not "300 or more".
  - Its helpers backdate `started_at` and `paused_at` on the app's clock, the one the timer reads.

## Completion Notes

- The reading-sessions suite passes 3 runs out of 3 with the fix (21 tests).
  With main's `timer-service.ts`, the new exact test fails: "expected +0
  to be 300". The app's clock is frozen in the test, so Postgres's `now()`
  is minutes away from it.
- `pnpm test`: 160 files pass, 77 database suites skipped.
  `test-local.py`: 237 files, 2,623 tests pass.
- Typecheck is clean; lint has 0 errors.

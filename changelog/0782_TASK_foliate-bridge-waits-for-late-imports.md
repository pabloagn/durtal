# Task 0782: foliate-bridge test waits for the engine's late imports

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-865. On a busy machine (every suite run beside two production builds)
`src/__tests__/reader/foliate-bridge.test.ts` passed 29 of 29 but turned the
run red with 48 "Cannot load ... after the environment was torn down"
errors. The foliate engine loads some modules without waiting for them: the
media handling for each section (`void import("../../media/document")`) and
the overlayer for marks. When those loads were slow, `media/document.ts` was
still loading when the file finished, and its own imports (`../input`,
`./content`, `./table-policy`) were asked for after the environment had gone.

## Implementation Details

- The file's `afterEach` now awaits `vi.dynamicImportSettled()` after
  destroying the engine, so every import a test started finishes inside that
  test. The engine's callbacks already return early once it is destroyed.
  No test is skipped, retried or quarantined, and the engine is unchanged.

## Completion Notes

- Reproduced with a scratch Vitest config (not committed) that holds the
  transform of `media/document.ts` and `overlayer.js` for 6 s, as a loaded
  machine would: on main 3 of 6 runs exited red (30, 48 and 48 errors, the
  same message and modules as the report); with the fix 6 of 6 runs passed
  with no errors.
- On its own the file passes 29 of 29, three times in a row (about 0.5 s of
  tests, as before).
- Every suite (`pnpm test`) beside a production build, three rounds in a
  row: 6,266 passed each time, no errors.
- `pnpm typecheck` passes. No new packages.

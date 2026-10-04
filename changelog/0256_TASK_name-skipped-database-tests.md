# Task 0256: Name the Database Tests That `pnpm test` Skips (SLN-434)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0249 (SLN-249, CI runs `pnpm test:local`)
**Blocks**: None

## Overview
`pnpm test` skips all 41 database suites in `src/__tests__/integration/`
(391 tests) and still passes. After migration 0052 a broken database test
landed this way. Two changes close the gap:

1. CI runs `pnpm test:local` on every pull request and push (SLN-249, PR #33),
   so a broken database test blocks a change. That script fails when any test
   is skipped.
2. `pnpm test` now names every database suite it skipped and says how to run
   them.

## Implementation Details
- `scripts/qa/skipped-database-reporter.ts`: a Vitest reporter. At the end of
  the run it lists each suite under `src/__tests__/integration/` with skipped
  tests, with the count, and points to `pnpm test:local`. It prints nothing
  when no database test is skipped.
- `vitest.config.ts`: reporters are `default` plus that reporter.
  `scripts/qa/test-local.py` sets its own reporters on the command line, so
  the full run is unchanged.
- `CLAUDE.md` and `docs/12_DEVELOPMENT.md`: the rule to run `pnpm test:local`
  before landing, and both test commands.

## Completion Notes
Checked on the worktree off `main` (c9f6359): lint and typecheck passed.
`pnpm test` passed 1097 tests and printed the 41 skipped suites (391 tests).
`pnpm test:local` passed 1488 of 1488, 0 skipped.

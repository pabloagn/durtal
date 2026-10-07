# Task 0365: Three reliability fixes: the goal dialog tests, the phone audit and the synthetic preview

**Status**: Completed
**Created**: 2026-10-07
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Three small problems that other work ran into: two tests that sometimes time
out (SLN-525), a QA script that crashes after its report (SLN-526), and a
page-weight route that fails on the synthetic preview (SLN-527).

## Implementation Details

- **SLN-525, the goal dialog tests.** The goal dialog test in
  `src/__tests__/ui/goal-dialog.test.ts` and "opens the goal dialog from the
  header's Set a reading goal" in `src/__tests__/ui/reading-stats.test.ts`
  took 3.3 to 3.9 s of Vitest's 5 s limit in full runs, and each timed out
  once. The time was not the dialog: the button loads the dialog lazily, so
  the first click imported `src/components/reading/goal-dialog.tsx` and its
  module graph, and Vitest transformed it inside the test. Each file now
  imports that module in a `beforeAll` with its own 30 s limit. The click
  still opens the dialog through `React.lazy`, from the module cache. No test
  is skipped and no test timeout is raised.
- **SLN-526, the phone audit.** `scripts/qa/phone-audit.mjs` removed its
  temporary Chrome profile in its exit handler right after a kill signal,
  while Chrome was still writing into it: ENOTEMPTY. After the report it now
  kills Chrome and waits for it to exit before it exits; the exit handler
  removes the profile, and retries a file Chrome wrote last (`maxRetries`, as
  `interaction-audit.mjs` does) for the crash path, where it cannot wait.
- **SLN-527, the synthetic preview.** `page-weight.js` opens the first
  organization linked from `/organizations`, and the synthetic catalogue had
  none. The seed in `scripts/qa/preview-local.py` adds one publisher,
  Gallimard, linked to the French editions.

## Completion Notes

- SLN-525: the two tests took 1,313 ms and 995 ms alone before; 50 and 51 ms
  alone after, and 60 and 74 ms inside a whole `vitest run`.
- SLN-526: three runs of `phone-audit.mjs` on a production preview each end
  with "No page scrolls sideways", exit 0, and no error.
- SLN-527: on a fresh synthetic production preview, `page-weight.js` exits 0;
  `/organizations/gallimard` is 52 of 400 KB in 14 ms. The three detail
  routes with an `ifNone` note (quotes, finished year, import) are skipped by
  design.
- SLN-528 (`/reading/year` at 3.2 s on the newest backup) is not reproduced
  and needs no code: on the same dump, a production build answers its first
  request in 20 ms and the next five in 6 to 11 ms, and `page-weight.js`
  measures 4 ms. A dev server takes 1.77 s for the first request, which
  compiles the route, then 24 to 37 ms. The findings are on SLN-528.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 252 files, 2,812 tests, all passed; the two goal
  dialog tests took 48 ms each in it.

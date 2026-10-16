# Task 0860: Validate delegating action inputs in CI

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: The held CI merge queue

## Overview

SLN-976: the cross-layer input-validation guard mistook the catalogue result adapters and client wrappers for unvalidated actions. It searched each exported function for parser text instead of following the complete forwarding chain. Current taxonomy adapters have the same shape.

## Implementation Details

- Use the existing TypeScript compiler dependency to enumerate exported functions and inspect actual function bodies. Async expression exports, mutating variable exports, re-exports and unsupported async declarations fail explicitly instead of disappearing.
- Follow only the supported transparent client-unwrapper and server-result-adapter forms, with resolved local imports, matching typed targets and unchanged argument tuples. Missing targets, unsupported forms and cycles fail closed.
- Preserve direct parser and reviewed helper coverage. Comments, strings, neighbouring functions and uncalled nested helpers cannot supply parser evidence. The two existing reader-lock retry delegates have explicit helper/schema and argument-forwarding checks.
- Add positive and adversarial fixtures covering the catalogue/taxonomy chain shape, imports, wrappers, arguments, parser removal, unsupported exports, local retries and cycles.
- No application code, runtime behavior, schemas, dependencies or CI workflow changes.

## Completion Notes

The first authorized focused run used Node 22.23.3 and one Vitest worker, with no database, build or browser. It passed 129 checks and identified two existing reader-lock delegates (`updateEdition` and `updateReadingNote`) whose validators are local helpers. Their precise forwarding paths were inspected and explicit proof plus regression fixtures were added. Reports from the first run: `/private/tmp/sln976-focused.json` and `/private/tmp/sln976-focused.log`.

The authorized rerun at source commit `66439eeede2bf2aa56b1b368eb8a95f083a2d898` passed **133/133 tests** across two files, with **0 failures, 0 pending tests and 0 skipped tests**: 98 action-validation checks and 35 proof fixtures. It ran with one Vitest worker on Node 22.23.3 in 636 ms, with no database, build or browser. Final reports: `/private/tmp/sln976-final-66439eee.json` and `/private/tmp/sln976-final-66439eee.log`.

Root's independent static review of that source found no blocking issue. This final receipt commit changes only this changelog; the tested implementation is unchanged.

Full typecheck on `76f5f6b2` exposed two TS2339 errors where TypeScript did not retain a call-expression narrowing inside the argument-check callback. The follow-up stores the already-checked expression in a local constant; no proof logic changes.

Under grant 11b, the combined focused check passed **146/146 tests**, with **0 failures and 0 skips**, and the subsequent full `pnpm typecheck` exited **0** on Node 22.23.3. Reports: `/private/tmp/sln976-977-grant11b-focused.json`, `/private/tmp/sln976-977-grant11b-focused.log` and `/private/tmp/sln976-977-grant11b-typecheck.log`.

`git diff --check` passes. Full final-head hosted CI remains required before landing. The branch has not been pushed.

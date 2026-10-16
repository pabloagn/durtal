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

The first authorized focused run used Node 22.23.3 and one Vitest worker, with no database, build or browser. It passed 129 checks and identified two existing reader-lock delegates (`updateEdition` and `updateReadingNote`) whose validators are local helpers. Their precise forwarding paths were inspected and explicit proof plus regression fixtures were added. The adjusted source awaits a further authorized focused run and full hosted CI; no passing result is claimed for the final source yet. Reports from the first run: `/private/tmp/sln976-focused.json` and `/private/tmp/sln976-focused.log`.

`git diff --check` passes. Full typecheck and hosted CI remain required before landing. The branch is prepared for independent review and has not been pushed.

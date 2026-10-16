# Task 0861: Check the optional taxonomy term budget contract

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: The held CI merge queue

## Overview

SLN-977: the exact page-weight exemption whitelist predates the taxonomy term route. The manifest intentionally measures taxonomy root and family pages unconditionally and permits the term-detail row to skip only when no subject term exists.

## Implementation Details

- Keep the exact exemption whitelist and add only `/taxonomy/subjects/*`, with its exact `no subject terms` note.
- Assert all three taxonomy manifest rows and unchanged 300 KB / 1000 ms limits; the root and family have no exemption.
- Run the real page-weight script against a local fixture HTTP server to prove empty term selection skips only the detail, populated selection performs warm-up and measured term requests, and an over-budget populated term fails.
- Preserve existing empty-route and failure cases. No manifest, budget, production query or catalogue changes.

## Completion Notes

The focused guard and page-weight run passed **146/146 tests** across three files, with **0 failures and 0 skips**: 98 action-validation checks, 35 delegation-proof fixtures and 13 page-weight cases. It used one Vitest worker with Node 22.23.3 and the fixture HTTP server in 1.34 seconds. Reports: `/private/tmp/sln976-977-focused.json` and `/private/tmp/sln976-977-focused.log`. The only subsequent change was this validation receipt; the tested code is unchanged. Full typecheck is queued for the shared heavy slot, and full final-head hosted CI remains required before merge. No provider calls, live writes, migrations or deployment.

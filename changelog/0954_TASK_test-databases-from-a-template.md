# Task 0954: Test databases reset from a migrated template

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: SLN-1197

## Overview

The database suites spent most of their time re-applying the whole migration chain (91 migrations, about 1.8 s) before each of 961 tests, one test file at a time. `test-local.py` now migrates one template database per run, and each reset replaces a suite's database with a copy of it. Test files run side by side again. Source: findings/ci-speed-survey-2026-10-18.md, with its prototype findings/ci-speed-clone-reset.diff. Fixes SLN-1196.

## Implementation Details

- `scripts/qa/test-local.py`:
  - Creates `sln0_template` after the suites' databases.
  - Migrates `sln0_template` once with Drizzle's migrator, the same chain the suites ran.
  - Passes `sln0_template` to the tests as `DURTAL_TEST_TEMPLATE_DATABASE`.
  - The manifest check refuses a suite that claims the template's name.
  - `--no-file-parallelism` is gone.
  - The container starts with `max_locks_per_transaction=256`, since several suites drop and create schemas at once.
  - Vitest runs with `--hookTimeout=60000`. Side by side, a template copy can wait behind others' copies, and the first CI run had one suite's reset hook pass the default 10 s (`publishers.test.ts`, at 0f16fd69).
- `src/__tests__/integration/helpers/disposable-database.ts`: when the template is set, `resetDisposableDatabase` checks that this test owns the database, then runs `DROP DATABASE ... WITH (FORCE)` and `CREATE DATABASE ... TEMPLATE sln0_template` from the `postgres` maintenance database. It then checks the production guards exactly as before. Without the variable, for a suite run on its own, it drops the schemas and migrates as it always did. Open pools reconnect on their next query.
- `src/__tests__/integration/library-filters.test.ts`: the suite's debug pool sets `fetch_types: false`, so a reconnect after a reset sends no type query into the counted queries.
- No workflow file changes. CI already runs `test-local.py`, so it picks this up; the workflow changes are SLN-1198.

## Completion Notes

`python3 scripts/qa/test-local.py`, full runs in this container:
- Run 1: 804 files and 8,190 tests passed. Vitest 587 s, wall 685 s.
- Run 2, after merging main: 812 files and 8,235 tests passed. Vitest 478 s, wall 561 s.

First CI run, at 0f16fd69: 811 files passed and one reset hook timed out at 10 s, in Vitest 583 s.

For comparison, the CI test step on main's chain takes about 1,511 s of Vitest (#522's run at 39f60a3f). The survey measured 2,512 s down to 333 s on its machine.

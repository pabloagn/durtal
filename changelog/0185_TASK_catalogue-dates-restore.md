# Task 0185: Backups Restore catalogue_dates

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0182, 0184
**Blocks**: None

## Overview
A `pg_dump` of the live database after migrations 0037–0049 does not restore:
`catalogue_date_valid` (a check) and `catalogue_date_upper` (a generated column)
call `catalogue_month_days` without a schema, and pg_restore runs with an empty
search_path. The restore fails to create `catalogue_dates` and then loses its 16
foreign keys and its trigger (21 errors). Book data restores; the table is empty
on live. Reported by the session of task 0184 during its rehearsal.

## Implementation Details
- Migration 0051_catalogue_dates_restore: `CREATE OR REPLACE` of the two functions with
  `public.catalogue_month_days`. The bodies are otherwise identical, so stored
  bounds stay valid. No other function a restore evaluates (checks, generated or
  default columns, indexes) has the flaw: `publisher_name_key` uses built-ins
  only and `search_normalize` already calls `public.unaccent`.
- Test (`catalogue-provenance.test.ts`): every public function used by a check,
  column expression or index must call public functions with their schema, and
  date rows insert under `search_path = ''`. Without the fix it fails and names
  both functions.
- `scripts/qa/preview-local.py --from-dump` explains that the backup must come
  from pg_dump 16 when the container's pg_restore cannot read a newer archive.

## Completion Notes
- Proof on a copy of live data at 49 migrations: a dump restored with 21 errors
  before the fix; after it, `pg_restore --exit-on-error` succeeds, with the date
  row, the 16 foreign keys and all 660 works.
- Ordering: it follows 0050_match_preview (journal `when` 1790995355434), which
  went live first; an earlier timestamp would have made Drizzle skip 0050.
- Live: backup `~/personal/durtal-backups/live-before-0051-20261003-120631.dump`,
  then 0051 applied in 0.6 s (51 recorded). All 107 tables have the same
  fingerprint before and after. A new backup
  (`live-after-0051-20261003-120656.dump`) restores with `--exit-on-error`:
  51 migrations, 16 foreign keys to `catalogue_dates`, 660 works. The full
  local suite passes 1,192 tests across 89 files.
- A live dump made before 0051 still needs the SQL route to restore:
  `pg_restore -f out.sql FILE`, replace
  `SELECT pg_catalog.set_config('search_path', '', false);` with
  `SET search_path = public, pg_catalog;`, then run it with psql. This applies
  to `live-before-0051-20261003-120631.dump`; the pre-0037 backups restore as is.

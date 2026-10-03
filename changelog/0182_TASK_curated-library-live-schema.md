# Task 0182: Live Activation of the Curated-Library Schema

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: 0155–0180
**Blocks**: None

## Overview
Applies the curated-library migrations 0037–0049 to the live database and lands
the branch on `fix/backlog-0116-0121`, so every session builds on one schema and
the migration numbers stop colliding. Books work as before; perfumes, films and
paintings stay disabled (`WORK_DOMAINS` and `works_kind_enabled_check`).

## Implementation Details
- `scripts/qa/preview-local.py --from-dump FILE` rehearses pending migrations on a
  `pg_dump --format=custom` backup: it restores the backup into the disposable
  database, copies every table to `rehearsal_before`, migrates, and reports per
  table the copied rows that were removed or added (compared on the copied
  columns), plus each new table's row count. Then it serves the app on that copy.
- Live check before applying: 36 recorded migrations, the last one
  0036_publisher_hierarchy; files 0002–0036 match the recorded hashes (0000 and
  0001 share one historic row). All thirteen new journal `when` values are newer.
- Live is applied with the drizzle postgres-js migrator, the same path as the
  rehearsal and the test suite.

## Completion Notes
- Backups (custom format, PostgreSQL 16 `pg_dump`):
  `~/personal/durtal-backups/live-before-0037-20261003-0428.dump` and the final
  `~/personal/durtal-backups/live-before-0037-20261003-043611.dump`. The first was
  restored to postgres:16 with no error; all 74 tables matched live row counts
  (16,868 rows). A per-table fingerprint just before migrating proved no write
  after the final backup.
- Rehearsal on the restored backup: all thirteen migrations applied with no error.
  73 of 74 tables are identical; `taxonomy_families` gained only the 8 domain
  families (film, perfume and painting vocabularies, all system families).
  New data: 2,166 `person_domains` (one book row per author), 26 `credit_roles`,
  35 `taxonomy_applicability`; all 660 works are books; no publishing house lost
  its book profile. 25 main pages loaded on the copy with no error.
- Live: migrated in 18.8 s, 49 recorded migrations. The before/after fingerprints
  of the existing columns differ only in `taxonomy_families` (10 → 18 rows), as
  rehearsed. The new domain families stay hidden on /taxonomy.
- Code: `codex/curated-library` merged the one new live commit (bec22b0, design
  audit script) and `fix/backlog-0116-0121` fast-forwarded to 765578f. The
  uncommitted edits of other sessions in the main checkout were untouched; they
  typecheck with the merged code. On :3100, 16 main pages render with no error
  and the browser console is clean.
- The `match-preview` worktree had an uncommitted `0037_match_preview`; its
  session was told to merge and renumber it to 0050. The next migration is 0050.
- Recovery: restore the final backup with `pg_restore --clean --if-exists
  --no-owner --no-privileges` into a new Neon branch, then point the app at it.
  Rollback disables new domains; it never drops the new tables.

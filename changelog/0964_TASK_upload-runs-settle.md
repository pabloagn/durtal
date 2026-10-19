# Task 0964: Upload runs settle with their last file

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Every browser-upload run stayed "running" for good. Nothing ever set its state or `finished_at`, so its run page refreshed every 10 seconds for as long as it was open, and the runs list showed every upload as still going (SLN-1395).

## Implementation Details
- `src/lib/ebooks/upload-core/run-settle.ts` (new): `settleUploadRunSql(runId)` settles an upload's run once every file in it is settled: canceled, expired, or added (a committed confirmation). The run is `failed` when a file was canceled after its check failed (`progress ? 'jobFailureV1'`), else `finished`, with `finished_at` set. It is a no-op while any file is open, for a run already settled, for a run with no files and for any other kind of run.
- `commands.ts`: a cancel runs it in the same transaction as the cancel. `ebook_ingest_runs` joins the transaction's sorted lock list.
- `effect-store.ts`: a confirmation runs it in the upload extension's `after` step, right after the command row is marked committed, in the same transaction. The atomic extension already locks `ebook_ingest_runs`.
- A registration still requires its run to be running (`requireUploadRegistrationSource`). That holds, because the run settles only once no file is open. Undo and restore don't require it.
- `docs/02_DATA_MODEL.md`: the `ebook_ingest_runs.state` note says when an upload's run settles.
- The run page already stops refreshing once its run is no longer running (`src/app/ebooks/runs/[runId]/page.tsx`), so no UI changed.

## Completion Notes
- `src/__tests__/integration/upload-run-settle.test.ts`: 4 tests on PostgreSQL 16 (`DURTAL_UPLOAD_RUN_TEST_DATABASE_URL`, database `sln1395_upload_run`). They cover: the run stays running while a file is open, then finishes; only a committed confirmation counts; a canceled failed check makes it failed; and settled, empty and non-upload runs are left as they are.
- Nothing writes `expired` today; the settle counts it once something does.
- A pending undo review taken before the run settled goes stale when it settles (its target snapshot includes the run row), so it asks for a fresh review. That needs another file to be the last one closed in between.
- No migration, no new package.

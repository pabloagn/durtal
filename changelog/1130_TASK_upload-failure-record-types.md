# Task 1130: Recording a failed upload check no longer crashes the upload service

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

On live, a test EPUB reached the upload service, its check failed, and the service stopped with PostgreSQL's "could not determine data type of parameter $8" (42P18). It restarted, picked up the same file and stopped again, so the upload page said the service was not running.

## Implementation Details

- `PostgresUploadStore.recordJobFailure` (`src/lib/ebooks/upload/store.ts`) put the fence's generation into `jsonb_build_object` as a bare parameter. The Neon driver sends parameters without types, and a `jsonb_build_object` argument gives PostgreSQL nothing to infer one from. It is now `::bigint`, so the record keeps the number the reader in `upload-core/store.ts` expects.
- `uploadReaderHashSql` (`src/lib/ebooks/upload-core/snapshots.ts`) had the same bare parameter, a table name inside `jsonb_build_object`, on the path a file takes once its check passes. It is now `::text`, as in `atomic-snapshots.ts`; the hashed JSON is unchanged.
- When recording the failure itself fails, the supervisor's error now carries why the check failed as well, so the service log says both (it logged only the recording error before).
- The query came with SLN-1388 (#566); its tests mocked the store, so it never ran against PostgreSQL.
- New `src/__tests__/integration/upload-job-failure.test.ts` (database `sln1388_upload_job_failure`) runs the store's own SQL against PostgreSQL 16 with untyped parameters, as the Neon driver sends them, and checks the file is marked failed with its reason and a numeric generation, and that the reading-rows fingerprint runs.

## Completion Notes

The new test fails with 42P18 before the fix and passes after it. Whatever made the live file's check fail is separate: with this fix that file shows as failed with its reason instead of stopping the service.

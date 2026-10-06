# Task 0342: One whole-file S3 read

**Status**: Completed
**Created**: 2026-10-06
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-300's remainder. The shared ingest path (`ingestMedia`,
`src/lib/media/ingest.ts`) already replaced the three copies of the media
pipeline (changelog 0169), so no route has its own copy. What was left: the
S3 read idiom `GetObjectCommand` + `obj.Body!.transformToByteArray()` was
still written out in five places, `display.ts` had its own reader that
skipped the preview's S3 folder, and `/api/media/process` loaded the S3
client with dynamic imports.

## Implementation Details

- `src/lib/s3/read-object.ts`: `readS3Object(key)` returns a stored file's
  bytes through `getS3Object`, so it reads the preview's folder when there is
  one; `bodyBytes(body, key)` reads a body the caller fetched itself. A file
  with no body fails with its key, not on `Body!`.
- `/api/media/process`, `/reprocess` and `/preview-monochrome` read through
  `readS3Object`; `/api/s3/read` keeps its conditional read and takes the
  bytes with `bodyBytes`. No dynamic S3 imports are left in `process`.
- `display.ts`'s reader is gone; `logo-card`, `reprocess-author` and
  `author-monochrome.ts` import the shared one.
- Tests: `src/__tests__/s3/read-object.test.ts` (S3, the preview's folder, a
  file with no body). `hardening.test.ts` keeps the real `getS3Object`
  behind its mocked client; `logo-cards.test.ts` mocks the new module.

## Completion Notes

- Two reads stay for now: `/api/media/backfill-palettes` and
  `setActiveMedia` (`src/lib/actions/media.ts`). PR #113 rewrites the first
  and edits the lines around the second; they move to `readS3Object` once
  #113 is on main.

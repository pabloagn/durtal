# Task 0399: Preview Deletes Clean Up Their Files

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: 0307 (SLN-450, the preview's S3 folder)
**Blocks**: None

## Overview

SLN-549, found by the collection checks (task 0395). In a preview started
with `scripts/qa/preview-local.py --s3-dir DIR`, uploads, reads and single
deletes use files under DIR, but the cleanup that follows a delete still
listed and batch-deleted through the S3 client, which has no bucket there.
Every preview delete of a collection, book, perfume, film or painting
therefore said its files still needed cleanup ("Collection deleted; some
artwork still needs cleanup.", "Perfume deleted; some image files could not
be removed yet"), and the files stayed in DIR. The cleanup now uses the
folder too, so a preview delete removes its files and says nothing is
pending. Nothing changes without the folder: the app and the live bucket
use the S3 client as before.

## Implementation Details

- `src/lib/s3/preview-dir.ts`:
  - `previewList(dir, prefix)` lists the keys that start with a prefix, as
    `ListObjectsV2` does, walking only the prefix's last folder. A prefix
    that leaves the folder is refused, as keys are.
  - `previewDeleteMany(dir, keys)` deletes several keys and answers as
    `DeleteObjects` does: a missing key counts as deleted, and a key it could
    not delete is listed in `Errors`.
- `src/lib/s3/cleanup.ts`: `listKeys` and the batch delete in
  `deleteUnusedObjects` use them when `previewS3Dir()` is set, as
  `uploadToS3`, `getS3Object` and `deleteFromS3` already do. The S3 branch is
  unchanged.
- Test: `src/__tests__/s3/preview-cleanup.test.ts` (prefix listing, the batch
  delete's answers, a collection's cleanup in a folder keeping a key a row
  still stores and another collection's files, and the S3 client still used
  without the folder). Its cleanup test fails on the old `cleanup.ts`.
- `docs/07_STORAGE.md` (Deleting Files) and the `preview-local.py` help say
  so.

## Completion Notes

Built and checked in a cloud container, on main 2f696f56:

- `pnpm typecheck` clean; `pnpm lint` 0 errors, 75 warnings, as on main;
  `pnpm deadcode` clean; `scripts/qa/test-local.py` 3,025 of 3,025 tests in
  273 files, none skipped.
- Production build in a preview with `--s3-dir` and the synthetic catalogue
  (`preview-local.py --start --seed-large 50`), in headless Chrome 153,
  Firefox 155 and WebKit 26.6: a new collection with uploaded artwork and a
  new perfume with an uploaded image, each with a raw file added to its
  `bronze/` folder that no row names (only the folder listing finds it),
  deleted from the page. Each delete said "Collection deleted. Books remain
  in your library." or "Perfume deleted", with no pending cleanup, and none
  of their files stayed: 21 of 21 checks, no page errors, no
  `[s3-cleanup]` line in the app's log, and the folder empty after twelve
  such deletes.
- Not run here: `docker build` (GitHub builds the image on the PR). No page
  changes, so no page weight or layout audit.

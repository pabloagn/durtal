# Task 0151: Delete S3 files with the records that own them

**Status**: Completed
**Created**: 2026-09-28
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-282: only media deletes removed S3 files. Deleting a work, author, edition, comment or venue, or merging two authors, removed the rows and left their files in the bucket forever. Every delete now removes the files it leaves behind. One shared helper does this for all of them, with the same safety rules.

## Implementation Details

- `src/lib/s3/cleanup.ts` (new): `deleteUnusedObjects(stored, context)`.
  - Candidates: the stored keys under `gold/`, plus every object under the folders that only the deleted record used (`ownedPrefixes`).
  - A candidate that any remaining row still stores is kept. `KEY_COLUMNS` lists the columns checked, plus Calibre `formats` JSON.
  - Deletes in batches of 1000 with `DeleteObjects`, then deletes the `image_adjustments` rows of the deleted files.
  - Runs only after the database delete commits. It never throws. It logs `[s3-cleanup]` and returns `true` when files remain.
  - `workObjects(id)` and `authorObjects(id)` read the keys before the delete, because the cascade removes the rows that name them.
- `src/lib/s3/collection-cleanup.ts`: `cleanupCollectionArtwork` now calls the shared helper. It still accepts only keys inside the collection's own folders.
- `deleteWork`, `deleteAuthor`: comments, activity events, gallery layout and the record go in one `atomic()` write. The fire-and-forget `*.deleted` event is gone: it could land after the cleanup and only showed on the deleted page. Both return `{ id, cleanupPending }`.
- `mergeAuthors`: one `atomic()` write copies the source's work, edition and contribution-type links to the target (`onConflictDoNothing`), moves its comments and their `comment_added` events, deletes its other events and gallery layout, deletes the source and records `author.merged` on the target. Then the source's images and photo are deleted. The comment files stay with the moved comments.
- `deleteEdition`: deletes the row, then its cover folders (`gold/`, `silver/`, `bronze/covers/{id}/`), then records `work.edition_deleted`.
- `deleteMedia`, `bulkDeleteMedia`: the row goes first, then the files. A failed file delete no longer leaves a row without files. A file another row still uses is kept.
- `DELETE /api/comments/[commentId]`: the comment and its timeline event go in one write, then its attachment files.
- `DELETE /api/comments/[commentId]/attachments/[attachmentId]`: deletes only an attachment of the comment in the URL, then its file.
- `deleteVenue`: deletes the row, then its poster and thumbnail.
- `event-config.ts`: `author.merged` ("Merged author <name>").
- `scripts/maintenance/report-orphaned-s3.ts` (new): read-only report of `gold/` objects older than 24 hours that no row references.
- Docs: `docs/07_STORAGE.md` (new "Deleting Files" section), `docs/06_SERVER_ACTIONS.md`.

## Completion Notes

- Tests:
  - `src/__tests__/integration/s3-cleanup.test.ts` (new): 11 tests on local PostgreSQL with an in-memory bucket. It covers the acceptance case (a work with poster, gallery, edition cover and comment attachment leaves nothing under its folders), a borrowed file that must survive, the merge, edition, comment, attachment, media, venue and failure paths.
  - `src/__tests__/s3/cleanup.test.ts` (new): fails if a schema column with `s3` in its name is missing from `KEY_COLUMNS`.
  - The existing collection cleanup, collection, collection media and image adjustment tests pass unchanged.
  - Full suite: 443 passed, 125 skipped (DB tests without their env var). Typecheck and lint pass.
- Live data (read-only):
  - 4 media keys (2 posters) are stored under another work's folder. The reference check keeps them when that folder is swept.
  - The orphan report found 71 unreferenced `gold/` objects (6.9 MB) from earlier deletes: 28 covers, 28 work images, 15 author images. They were not deleted.

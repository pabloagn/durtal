# Task 0457: New edition covers in the edition's gold/media folder

**Status**: Completed
**Created**: 2026-10-12
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-643: new edition covers went to `gold/covers/{editionId}/attempt-{id}/`, outside the layer-first layout SLN-569 set (`gold/media`, `gold/ebooks`). New cover attempts now go to an edition-owned folder under `gold/media`. Covers already stored stay where they are and keep working; nothing is moved, rewritten or deleted.

## Implementation Details

- `src/lib/s3/keys.ts`: `goldCoverStageKeys` allocates `gold/media/edition/{editionId}/cover/attempt-{attemptId}/{cover,thumb}.webp`, with the same identity check (letters, digits and hyphens, 1 to 128) and a fresh attempt per save. `edition` is not an image owner (`MEDIA_ENTITY_TYPES`), so the folder holds only that edition's covers. `editionMediaPrefix`, `EDITION_MEDIA_PREFIX` and `LEGACY_COVER_PREFIX` name the two places.
- `isEditionCoverKey` recognises every legacy `gold/covers/` key and anything under `gold/media/edition/`, and nothing else: other owners' images, comment files, e-book keys and bronze/silver covers are not covers. Its three users change with it: record cleanup retains covers (`deleteUnusedObjects`), `/api/media/reprocess` refuses a poster whose thumbnail is an edition cover, and the orphan report lists covers under `retainedCovers`.
- `src/lib/s3/cleanup.ts`: `ownedPrefixes.edition` lists `gold/media/edition/{id}/` beside the legacy cover folders, so deleting an edition or a work inventories new covers too. They are retained like the old ones (no cover is deleted until a safe retirement exists).
- Unchanged: the conditional write and byte read-back in `cover-stage.ts`, the operation and target binding, `/api/s3/read` (it already serves `gold/media/`), stored rows and objects, and every e-book key, parser and signing policy.
- `docs/07_STORAGE.md`: cover keys, the pipeline, retention and the deletion table.

## Completion Notes

- Tests: `src/__tests__/s3/keys.test.ts` (new keys, refused identities, the classifier on new, legacy and unrelated keys, the edition folder apart from every image owner's, not an e-book key), `cover-retention.test.ts` (new covers found through the edition folder are retained while another owner's unused image is deleted), `reprocess-cover-alias.test.ts` (new-namespace thumbnail refused), `integration/s3-cleanup.test.ts` (deleting an edition keeps its new published and unpublished attempts and its legacy cover) `integration/atomic-book-writes.test.ts` (a failed new book leaves only new-namespace attempts) and `integration/fast-track.test.ts` (Fast Track stores its cover in the new folder).
- No migration, no new package, no live write. Before rollout, the Mac checks read-only that the live bucket policy, lifecycle rules and CDN serve `gold/media/edition/` like other `gold/media/` images.
- Gates in the cloud: typecheck, lint (no errors), deadcode (output identical to main), `pnpm test` 5,409 passed, build, and `test-local.py` 6,627 of 6,629: the fast-track expectation of the old prefix, since fixed (the suite passes), and `perfume-services` timing out at 5 s under full load (2.5 s alone, unrelated). No page changes, so no browser audit or page weight.

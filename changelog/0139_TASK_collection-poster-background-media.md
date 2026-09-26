# Task 0139: Collection posters and backgrounds with the shared media manager

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0133, 0132, 0138
**Blocks**: 0140

## Overview

SLN-326: Every collection can have a poster and a cover (background) image, managed exactly like book and author images: several per type, one active, framing (crop), brightness/contrast and the other shared adjustments, upload by drag, file or URL. The active poster shows in every grid and card; the active background is the collection page banner.

## Implementation Details

- Schema (migration `0029_collection_media`): `media.collection_id` (FK to `collections`, cascade), owner check `num_nonnulls(work_id, author_id, collection_id) = 1`, index `(collection_id, type, is_active)`. Existing collection images move into active `media` rows (poster column or legacy cover as the active poster, a distinct legacy cover kept as an inactive poster, background as the active background) with saved brightness/contrast copied from `image_adjustments`. The four collection image columns are then dropped. Live data had one collection and no collection images.
- `src/lib/actions/media.ts`: one owner map for works, authors and collections (active selection, deletion with promotion, listing). Collections record no activity events (they have no timeline). Collections accept poster and background only (validated in `createMediaSchema` and in all three upload routes before any processing).
- Upload, from-URL and presign/process routes create media rows for collections instead of writing collection columns (`src/lib/media/owner.ts`).
- Image adjustments resolve collection images as media rows, so the framing editor now works for them (2:3 poster, 16:9 background).
- `MediaManagerDialog` takes any owner; collections get Poster and Background tabs. The old single-image artwork dialog is replaced.
- `CollectionCard` (grid and carousels): active poster with its framing; member-cover collage only without a poster.
- Collection page: author-style full-width banner (`FullBleedLayer`) from the active background, poster beside the name.
- Deleting a collection cascades its media rows and sweeps its own S3 namespace.
- `docs/02_DATA_MODEL.md` updated.

## Completion Notes

- New PostgreSQL tests (disposable databases): per-collection activation, promotion on delete, owner and gallery rules (app and database), active-only artwork in queries, upload route creating an active row and refusing a gallery before processing. Migration rehearsal from a populated 0028 catalogue: images moved exactly, adjustments carried, old columns gone, work/author media untouched, owner check enforced, cascade on delete, re-run no-op.
- Older tests moved from the dropped columns to media rows; two older rehearsals compare `media` with `toMatchObject` for later columns.
- Full suite with every database suite enabled: 505 passed. Typecheck, lint, production compile pass.
- Browser check on a disposable preview borrowing existing images read-only: grid poster and collage, collection banner at full width (edges equal `main`), media manager with Poster/Background tabs, switching the active poster updates page and grid, Add-to-collection dialog unchanged. No uploads or deletions against live storage.
- Live activation needs migration 0029.

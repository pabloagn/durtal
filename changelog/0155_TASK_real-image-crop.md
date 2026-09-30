# Task 0155: Real image crop

**Status**: Completed
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

A crop saved in the media editor was only CSS framing (`object-position` + `transform: scale`) on the uncropped file. Views that did not apply the style showed the full image: the dashboard's recent authors, the author map popup, lightboxes and the media manager thumbnails. Views of another shape (square avatars, wide banners) showed parts that the crop had removed. The crop is now written into the image files, so every view shows it, and the image before the crop is kept.

## Implementation Details

- Migration `0033_media_applied_crop` adds `media.uncropped_s3_key` and `media.applied_crop` (`{ x, y, zoom }`), with check `media_applied_crop_check` (both set, or neither). `docs/02_DATA_MODEL.md`, `docs/07_STORAGE.md` and `docs/05_API_REFERENCE.md` updated.
- `src/lib/media/crop.ts`: `cropRegion()` turns the editor framing into the pixel rectangle the editor frame shows (2:3 posters, 16:9 backgrounds). Unit tests check it against the CSS model.
- `src/lib/media/display.ts`: `buildDisplayFiles()` writes the cropped full image and thumbnail to new version keys (`goldMediaVersionKeys`); `commitDisplay()` swaps the row in one transaction only when the row is unchanged since it was read, moves `image_adjustments` settings to the new key, and then deletes replaced files. A crop that cuts nothing writes no file.
- `src/lib/s3/references.ts`: `deleteUnreferencedS3Keys()` never deletes an object that a row still references (media, editions, author photos, venues, Calibre covers, attachments). Now also used by media delete (database row first, then files) and collection cleanup.
- `saveImagePresentation()` crops through the new path; the editor previews `uncropped_s3_key`. After a crop, `crop_x` / `crop_y` keep its focal point and `crop_zoom` is 100, so views of another shape show the chosen part without showing what was cut. `mediaImageStyle()` adds a transform only for a legacy zoom.
- `POST /api/media/reprocess-author` re-applies the saved crop to the new monochrome image and writes new keys instead of overwriting files. The unused in-place `reprocessAuthorMedia()` was removed.
- `POST /api/media/apply-crops` moves crops saved as CSS framing into files. Options: `dryRun=1`, `id=<media id>`.

## Completion Notes

- Migration applied to the configured database.
- `apply-crops` ran on the live library: Alexander Theroux first (`id`), then the rest. 169 rows: 168 cropped files written, 1 background whose crop cuts nothing kept its focal point, 0 failures. No row has a legacy zoom left. A CSV backup of `media` and `image_adjustments` from before the run was kept outside the repository.
- Browser checks: the dashboard shows Theroux without the book title. A difference-blend overlay of the new file on the editor preview (and of a banner against its old CSS view) is black apart from resampling noise, so the file matches the editor to under one pixel. The editor opens on the uncropped image with the saved crop. Alignment audit on the author page with the editor open: 26 checked, 0 issues.
- Tests: `pnpm typecheck` and ESLint pass; full suite 568 passed, 86 skipped (database suites with no database configured). Database suites run on a throwaway PostgreSQL 16 container: image adjustments (18, including crop, re-crop, reset, shared files, stale row, legacy move and monochrome re-process with an in-memory S3 and real sharp), collection media, collection media migration, collections, harmonization, image adjustment migration and series.

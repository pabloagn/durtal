# Task 0169: Media ownership, attribution and domain image presentation

**Status**: Completed
**Created**: 2026-10-01
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: SLN-349, SLN-350, SLN-355, SLN-282 (merged), SLN-278 (merged)
**Blocks**: SLN-366, SLN-367, SLN-368, SLN-369, SLN-370, SLN-381

## Overview

SLN-361 extends images to the new domains: new owners, per-domain sizes and
frames, one ingest path that cleans up after failures, and alt text, credit,
license and source on every image. It builds on SLN-282 (file cleanup on
delete) and SLN-278 (safe URL downloads), merged into this branch first.

## Implementation Details

- Migration 0045: `media` gains `organization_id`, `art_object_id` and
  `perfume_variant_id` (real foreign keys, exactly one owner), and `alt_text`,
  `credit`, `license`, `license_url`, `source_url`, `source_record_id`.
  `media_type_check` limits each owner's image types; `media_source_guard`
  requires a source of the same record. The migration stops, unchanged, if an
  existing row has an unknown type or a collection gallery.
- `src/lib/media/policy.ts`: book and film posters portrait with a focal crop;
  perfume posters square and contained; painting and art object images native,
  contained, 4096 px, with a full-resolution original; backgrounds landscape.
  Existing book, author and collection sizes are unchanged.
- `src/lib/s3/media.ts` renders sizes only (`renderImage`, `renderAuthorImage`),
  applies EXIF orientation and drops metadata, including location.
- `src/lib/media/ingest.ts`: the one path from a received image to stored files
  and a media row, used by `/api/media/upload`, `/from-url` and `/process`. The
  row is recorded and activated in one transaction. If an upload or the
  database write fails, the files already stored are deleted again. Images from
  a URL record that URL as their source. This also removes the triplicated
  route code described in SLN-300.
- `updateMediaDetails()` edits alt text and attribution without touching the
  file. `setActiveMedia()` is now one transaction.
- Cleanup: the new owners have their own folders; deleting an organization, art
  object, formulation or a whole perfume, film or painting removes their images.
- `src/lib/media/presentation.ts` gives each frame's ratio, fit, focal point,
  scale and alt text; contained frames ignore crops; native frames follow the
  image within 1:2.5 to 2.5:1; missing images keep their frame.
- UI: the media manager shows an "Image details" form under the active poster
  or background, and for a clicked gallery image. Previews use the stored alt
  text.

## Completion Notes

- `pnpm typecheck` passes. ESLint on the changed source passes.
- `pnpm test:local`: 1000 tests across 79 files, zero skipped, plus five Python
  checks. New: `src/__tests__/media/policy-presentation.test.ts`,
  `src/__tests__/media/render.test.ts` (real image rendering: sizes, ratios,
  kept originals, no enlargement, orientation, monochrome) and
  `src/__tests__/integration/media-ingest.test.ts` (owners and folders,
  atomic activation, refusals, cleanup after database and upload failures,
  attribution edits, author originals, deletion cleanup, database checks).
- Browser, disposable preview database: the details form at 1440, 768 and
  390 px; link errors in the app's style, save, database check, gallery
  selection; 0 alignment deviations; Escape closes the dialog. At 390 px the
  page itself still overflows (SLN-312).
- Not in scope: image delivery caching (`/api/s3/read` still sends no-store,
  SLN-295) and the author media manager form, which keeps its own dialog.

# Task 0116: Media Brightness and Contrast Filter

**Status**: Completed
**Created**: 2026-09-24
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

Add brightness and contrast adjustments to media on any entity that has media (works and authors). The adjustment must behave exactly like the existing crop: stored per media row, non-destructive (the S3 file is never modified), edited in the media manager, and applied at render time wherever the image appears.

## Implementation Details

### How crop works today (the pattern to copy)

- **Columns**: `crop_x`, `crop_y`, `crop_zoom` on `media` (`src/lib/db/schema/media.ts:44-47`, migration `0009_clean_wild_pack.sql`).
- **Validation**: `updateMediaCropSchema` in `src/lib/validations/media.ts:61-69`.
- **Save**: `updateMediaCrop()` in `src/lib/actions/media.ts:168-177` (updates the row, invalidates `works` and `media` cache tags).
- **Editor**: `src/components/books/media-crop-editor.tsx`, used for posters and backgrounds only:
  - Works: `src/components/books/media-manager-dialog.tsx:280-305`
  - Authors: `src/components/media/author-media-manager-dialog.tsx:307-330`
- **Render**: an inline `objectPosition` + `transform: scale()` style, copy-pasted at about 15 sites (book card, list, data table, work poster/background, series thumbnails, author card/list item/header/background, authors table, author timeline).

### Proposed approach

1. Add `brightness` and `contrast` columns to `media` (REAL, NOT NULL, default `100`, i.e. percent). Drizzle migration + update `docs/02_DATA_MODEL.md`.
2. Extend the crop schema/action (or add a sibling action) to save them.
3. Add two sliders to `media-crop-editor.tsx` with a live preview.
4. Apply as CSS `filter: brightness(x%) contrast(y%)` at every render site. Most sites only add the crop style when values differ from defaults, so the filter needs its own default check.
5. Strongly consider a shared `getMediaImageStyle(media)` helper to replace the ~15 duplicated style blocks, and consolidate the duplicated `CoverCrop` / `PosterCrop` types.
6. Add the new columns to every query that already selects crop fields (`works.ts`, `authors.ts`, `series.ts`, `orders.ts`, `author-timeline.ts`, `work-timeline.ts`, taxonomy item page, provenance page).

### Notes and open questions

- Do not confuse this with the existing author **monochrome processing** (`media.processing_params`: contrast, brightness, gamma, sharpness). That is a server-side Sharp pipeline that rewrites the S3 image. This task is CSS-only, like crop.
- Existing gaps where crop is loaded but not applied: work timeline markers, provenance views. Gallery and collage images have no crop at all. Decide whether the filter should cover these too.

## Completion Notes

### Database (migration `0022_media_brightness_contrast`, applied to local copy and live Neon)

- `media.brightness` and `media.contrast`: REAL, NOT NULL, default 100 (percent). Live: 534 rows, all 100.
- `docs/02_DATA_MODEL.md` updated.

### Shared helper `src/lib/utils/media-style.ts`

- `MediaCrop` `{ x, y, zoom, brightness?, contrast? }`. The duplicated `PosterCrop` / `CoverCrop` types are now aliases of it, and the timeline item types use it.
- `mediaCrop(row)`: media row -> `MediaCrop` (nulls -> defaults).
- `mediaFilter(crop)`: `brightness(x%) contrast(y%)`, or undefined when both are 100.
- `mediaImageStyle(crop)`: the only style builder now. Crop only when not default, filter only when not 100.

### Render sites (all use `mediaImageStyle`)

Book card, book list, book data table, work page poster (`WorkPosterImage` now takes `crop`) and background, series thumbnails, taxonomy item cards, author card, author list item, authors table, author header and background, author timeline and timeline rows. Gaps closed: the work timeline markers and hover cards, and the provenance posters (pipeline, detail, timeline, order dialog) loaded crop data but never applied it; they now apply crop and filter.

Side effect: the work page poster and author/work backgrounds no longer set an inline `transform: scale(1)` when the crop is default, so the poster's existing `hover:scale` class now works there too (same as the other cards).

### Data

Every query that selects crop fields also selects `brightness` and `contrast` (`works.ts`, `authors.ts`, `series.ts`, `orders.ts`, `author-timeline.ts`, `work-timeline.ts`, taxonomy item page); provenance page and dashboard types carry them.

### Editor and save

- `MediaCropEditor`: Brightness and Contrast sliders (50-150%) with live preview, Reset covers all five values, one "Save".
- `updateMediaCropSchema`: optional `brightness` / `contrast`, 0-200. Toasts say "Image settings saved".

### Out of scope

- Gallery and collage images (no crop editor exists for them).
- Author monochrome `processing_params` is unchanged.

### Tests

- `src/__tests__/utils/media-style.test.ts`: 11 tests (helper and validation).
- Headless Chromium on a production build (local DB copy), 20 checks pass: editor live preview, save stores 130/80, work page, library grid/list/table, series page, taxonomy page, work timeline, authors grid/list/table/timeline, author header and background, editor loads saved values, Reset saves 100/100 and removes the filter.
- Provenance poster checked on the dev server (pass): the production build pre-renders `/provenance` as a static page (see note below), so a direct DB change does not show there.
- After the live migration: 12 main pages load with status 200 and no errors on the running dev server (live data).
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (275 tests) pass; `drizzle-kit generate` reports no drift.

### Note (pre-existing, not changed here)

`next build` marks `/`, `/collections`, `/provenance` and `/series` as static (○) although they read the database, so a production build can show build-time data on those pages.

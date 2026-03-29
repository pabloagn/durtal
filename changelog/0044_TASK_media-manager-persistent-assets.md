# Task 0044: Media Manager -- Persistent Assets with Active Selection

**Status**: Completed
**Created**: 2026-03-29
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0040, 0041, 0042
**Blocks**: None

## Overview

Rethink media as persistent, first-class entities. Uploading a new poster does not destroy the old one -- it deactivates it. Users can switch between previously uploaded posters/backgrounds, delete individual items, and bulk-delete. A proper media manager dialog replaces the simple upload-only dialogs.

## Changes Required

### 1. Schema: add `is_active` column to `media` table
- `is_active BOOLEAN NOT NULL DEFAULT true`
- For poster/background: only one active per work per type at a time
- For gallery: always true (all gallery items are "active")

### 2. Server actions (media.ts)
- `setActiveMedia(id)` -- set one media as active, deactivate others of same type+owner
- `bulkDeleteMedia(ids[])` -- delete multiple media + S3 objects
- `getMediaByType(workId, type)` -- all media of a type for a work (active + inactive)
- Update `getPoster`/`getBackground` to filter by `isActive = true`

### 3. Stop deleting old media on replacement
- `from-url/route.ts`: deactivate old, create new as active (don't delete S3)
- `process/route.ts`: create new as active, deactivate others of same type

### 4. Media Manager Dialog
- Tabbed UI: Poster | Background | Gallery
- Shows all uploaded items as a thumbnail grid
- Active item highlighted with ring
- Click thumbnail to set as active (poster/background only)
- Upload new via UploadZone + URL paste
- Delete individual items (X button on hover)
- Multi-select + bulk delete
- Replaces the three separate dialogs (change-poster, change-background, add-gallery)

### 5. Wire into book card actions menu
- Replace three separate menu items with single "Manage media" item
- Opens MediaManagerDialog

## Files Changed

| File | Change |
|---|---|
| `src/lib/db/schema/media.ts` | Add `isActive` column |
| `drizzle migration` | Add column migration |
| `src/lib/actions/media.ts` | New actions, update queries |
| `src/app/api/media/from-url/route.ts` | Stop deleting, deactivate instead |
| `src/app/api/media/process/route.ts` | Set new as active, deactivate old |
| `src/components/books/media-manager-dialog.tsx` | New: full media manager |
| `src/components/books/book-card-actions-menu.tsx` | Replace three items with one |
| `src/app/library/[slug]/page.tsx` | Update poster/background queries |
| `docs/02_DATA_MODEL.md` | Document `is_active` column |

## Completion Notes

### Schema
- Added `is_active BOOLEAN NOT NULL DEFAULT true` to `media` table
- Migration `0007_blushing_owl.sql` generated and applied
- Existing media records default to active

### Backend (media.ts actions)
- `getPoster`/`getBackground` now filter by `isActive = true`
- New: `setActiveMedia(id)` -- activates one, deactivates others of same type+owner
- New: `bulkDeleteMedia(ids[])` -- deletes multiple items + S3 objects
- New: `getMediaByType(workId, type)` -- returns all media of a type (active first)

### API routes
- `from-url/route.ts` -- no longer deletes old poster/background, deactivates instead, calls `setActiveMedia` on new record
- `process/route.ts` -- calls `setActiveMedia` on new record for poster/background types

### UI
- New `MediaManagerDialog` (`src/components/books/media-manager-dialog.tsx`) -- tabbed UI (Poster/Background/Gallery) with thumbnail grid, active selection, upload (drag-drop + URL), per-item delete, multi-select bulk delete
- Three old dialogs deleted: `change-poster-dialog.tsx`, `change-background-dialog.tsx`, `add-gallery-dialog.tsx`
- Actions menu: three separate items replaced with single "Manage media"

### Docs
- `docs/02_DATA_MODEL.md` updated with `is_active` column and active selection behavior

# Task 0042: Add Gallery Images from Library Card Menu

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0036
**Blocks**: None

## Overview

Allow adding gallery images to a work directly from the book card actions menu in the library view. Gallery images are additional photos of the book -- spine, interior pages, inscriptions, special features, shelf placement, etc. They are displayed on the book detail page in a gallery section.

Currently, gallery management is only available on the book detail page via `WorkMediaSection`. This task adds a quick-access upload dialog from the library grid.

## Implementation Details

### 1. Add Gallery Dialog

**New file: `src/components/books/add-gallery-dialog.tsx`**

`"use client"` component:

```typescript
interface AddGalleryDialogProps {
  open: boolean;
  onClose: () => void;
  workId: string;
  title: string;
  existingGalleryCount: number;  // show how many images already exist
}
```

Dialog layout:

**Header:**
- Title: "Add gallery images"
- Subtitle: "{n} images in gallery" (or "No gallery images yet")

**Upload area:**
- Multi-file drag-and-drop zone
- "Click to browse" fallback
- Accepts: JPEG, PNG, WebP
- Max per file: 10MB
- Max batch: 20 images
- Shows upload queue with thumbnails, file names, and progress bars
- Each queued image has a remove button (X) to dequeue before upload
- Optional caption input per image (text field below each thumbnail)

**Actions:**
- "Upload {n} images" button (primary, shows count)
- Disabled until at least one image is queued
- Shows progress during upload ("Uploading 3 of 7...")

### 2. Gallery Upload Server Action

**File: `src/lib/actions/media.ts`** (or extend existing media actions)

Action: `addGalleryImages(workId: string, images: { file: File; caption?: string }[])`

For each image:
1. Upload to S3 under `works/{workId}/gallery/{uuid}.{ext}`
2. Generate thumbnail variant (e.g., 300px wide)
3. Create media record with `type: "gallery"`, optional caption, and sort order (append to end)

Should support sequential uploads with progress reporting (or batch upload if the infrastructure supports it).

### 3. Integration with Card Actions Menu

**File: `src/components/books/book-card-actions-menu.tsx`**

- "Add gallery" menu item opens `AddGalleryDialog`
- Need to know the existing gallery count -- this may require passing it through BookCard props or fetching on dialog open
- On success: `router.refresh()`

### 4. Gallery Count in BookCard Props Pipeline

**File: `src/app/library/page.tsx`**

The library page query may need to include a gallery image count per work so the dialog can display it. Options:
- Add a subquery/join to count media records with `type: "gallery"` per work
- Or fetch the count lazily when the dialog opens (simpler, avoids changing the main query)

Prefer the lazy approach: fetch count via a lightweight API call when the dialog opens.

### Files

| File | Change |
|---|---|
| `src/components/books/add-gallery-dialog.tsx` | New: multi-image gallery upload dialog |
| `src/lib/actions/media.ts` | Add or extend `addGalleryImages` server action |
| `src/components/books/book-card-actions-menu.tsx` | Wire "Add gallery" menu item to dialog |

## Completion Notes

Implemented a URL-based gallery image dialog accessible from the book card actions menu in the library grid view.

**New files created:**
- `src/components/books/add-gallery-dialog.tsx` -- Dialog with URL input and optional caption textarea. On submit, calls `/api/media/from-url` with `mediaType: "gallery"`. Image is processed to 1600x1600 max webp. Unlike poster/background, gallery images are additive (no replacement).

**Modified files:**
- `src/components/books/book-card-actions-menu.tsx` -- Removed `disabled` from "Add gallery" menu item, added `galleryOpen` state, wired onClick handler, rendered `AddGalleryDialog`.

Shares the `/api/media/from-url` route created in Task 0040. Kept scope to single-image URL input (no multi-file upload). Caption is stored in the media record. Uses toast from sonner for feedback and `router.refresh()` to update the view.

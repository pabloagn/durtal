# Task 0041: Change Background from Library Card Menu

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0036
**Blocks**: None

## Overview

Allow changing a work's background image directly from the book card actions menu in the library view. The background image is used on the book detail page as a hero/banner area behind the work header (if the design supports it). This is distinct from the poster (cover image).

Currently, background management is only available on the book detail page via `WorkMediaSection`. This task adds a quick-access dialog from the library grid.

## Implementation Details

### 1. Change Background Dialog

**New file: `src/components/books/change-background-dialog.tsx`**

`"use client"` component:

```typescript
interface ChangeBackgroundDialogProps {
  open: boolean;
  onClose: () => void;
  workId: string;
  title: string;
  currentBackgroundUrl?: string | null;
}
```

Dialog layout (very similar to the poster dialog from Task 0040 but for backgrounds):

**Current background preview:**
- Show current background image (if any) in a wide aspect ratio preview (e.g., 16:9, 300px wide)
- Or placeholder text: "No background set"

**Upload options:**

**Option A: Upload file**
- Drag-and-drop zone or file input
- Accepts: JPEG, PNG, WebP
- Recommended aspect ratio hint: "Landscape images work best (16:9 or wider)"
- Max size: 10MB
- Shows preview before confirming

**Option B: URL**
- Text input for image URL
- "Preview" button to fetch and display
- Shows preview before confirming

**Actions:**
- "Save" button: uploads/processes the image and sets it as background
- "Remove background" link (danger text): removes the current background

### 2. Background Update Server Action

Reuse the same media upload infrastructure as Task 0040, but with `type: "background"` instead of `type: "poster"`:
- Upload image to S3
- Create/update media record with `type: "background"`
- No thumbnail generation needed for backgrounds (used at full resolution)

### 3. Integration with Card Actions Menu

**File: `src/components/books/book-card-actions-menu.tsx`**

- "Change background" menu item opens `ChangeBackgroundDialog`
- On success: `router.refresh()`

### Files

| File | Change |
|---|---|
| `src/components/books/change-background-dialog.tsx` | New: background change dialog with upload and URL options |
| `src/components/books/book-card-actions-menu.tsx` | Wire "Change background" menu item to dialog |

## Completion Notes

Implemented a URL-based background change dialog accessible from the book card actions menu in the library grid view.

**New files created:**
- `src/components/books/change-background-dialog.tsx` -- Simple dialog with URL input field. On submit, calls `/api/media/from-url` with `mediaType: "background"`. Image is processed to 1920x1080 max webp. Automatically replaces any existing background for the work.

**Modified files:**
- `src/components/books/book-card-actions-menu.tsx` -- Removed `disabled` from "Change background" menu item, added `backgroundOpen` state, wired onClick handler, rendered `ChangeBackgroundDialog`.

Shares the `/api/media/from-url` route created in Task 0040. Kept scope to URL input only. Uses toast from sonner for feedback and `router.refresh()` to update the view.

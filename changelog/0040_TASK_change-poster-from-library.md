# Task 0040: Change Poster from Library Card Menu

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0036
**Blocks**: None

## Overview

Allow changing a work's poster image directly from the book card actions menu in the library view, without navigating to the book detail page. The poster is the cover image displayed on the book card and at the top of the detail page.

Currently, poster management is only available on the book detail page via `WorkMediaSection`. This task adds a quick-access dialog from the library grid.

## Implementation Details

### 1. Change Poster Dialog

**New file: `src/components/books/change-poster-dialog.tsx`**

`"use client"` component:

```typescript
interface ChangePosterDialogProps {
  open: boolean;
  onClose: () => void;
  workId: string;
  title: string;
  currentPosterUrl?: string | null;
}
```

Dialog layout:

**Current poster preview:**
- Show current poster image (if any) at small size (150px height)
- Or placeholder text: "No poster set"

**Upload options (tabs or segmented control):**

**Option A: Upload file**
- Drag-and-drop zone or file input
- Accepts: JPEG, PNG, WebP
- Max size: 10MB
- Shows preview before confirming

**Option B: URL**
- Text input for image URL
- "Preview" button to fetch and display
- Shows preview before confirming

**Option C: Search covers**
- Search input (pre-filled with work title)
- Fetches cover images from Google Books and Open Library APIs
- Shows grid of available covers as clickable thumbnails
- Selecting a thumbnail sets it as the new poster

**Actions:**
- "Save" button: uploads/processes the image and sets it as poster
- "Remove poster" link (danger text): removes the current poster

### 2. Poster Update Server Action

**File: `src/lib/actions/media.ts`** (or `src/lib/actions/works.ts` if media actions don't exist separately)

Reuse or extend the existing media upload logic from `WorkMediaSection`:
- Upload image to S3 under the work's media path
- Generate thumbnail variant
- Create/update the media record with `type: "poster"`
- If replacing, mark old poster media record as replaced (or delete it)

Check existing media handling in `src/app/library/[slug]/work-media-section.tsx` -- the upload logic there should be extracted into a reusable action if not already.

### 3. Cover Search API

Reuse the search infrastructure from Task 0039 (`/api/match`), but extract just the cover URLs:
- Google Books: `volumeInfo.imageLinks.thumbnail` (request larger size via `&zoom=1`)
- Open Library: `https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg`

Or add a dedicated endpoint:

**New file: `src/app/api/covers/route.ts`**

```typescript
GET /api/covers?q=<title+author>&isbn=<isbn>
```

Returns array of `{ url: string; source: string; width?: number; height?: number }`.

### 4. Integration with Card Actions Menu

**File: `src/components/books/book-card-actions-menu.tsx`**

- "Change poster" menu item opens `ChangePosterDialog`
- On success: `router.refresh()` to update the card's cover image in the grid

### Files

| File | Change |
|---|---|
| `src/components/books/change-poster-dialog.tsx` | New: poster change dialog with upload, URL, and search options |
| `src/app/api/covers/route.ts` | New: API route for searching cover images from external sources |
| `src/components/books/book-card-actions-menu.tsx` | Wire "Change poster" menu item to dialog |

## Completion Notes

Implemented a URL-based poster change dialog accessible from the book card actions menu in the library grid view.

**New files created:**
- `src/components/books/change-poster-dialog.tsx` -- Simple dialog with URL input field. On submit, calls `/api/media/from-url` to download, process (via sharp to 800x1200 max webp), and store the poster in S3. Automatically replaces any existing poster for the work.
- `src/app/api/media/from-url/route.ts` -- Shared API route for all three media dialogs (poster, background, gallery). Downloads image from URL, processes via `processAndUploadMedia`, deletes existing poster/background if replacing, creates media DB record.

**Modified files:**
- `src/components/books/book-card-actions-menu.tsx` -- Removed `disabled` from "Change poster" menu item, added `posterOpen` state, wired onClick handler, rendered `ChangePosterDialog`.

Kept scope to URL input only (no file upload or cover search). Uses toast from sonner for success/error feedback and `router.refresh()` to update the library grid.

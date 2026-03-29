# Task 0037: Delete Work (Library View + Book Detail Page)

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0036
**Blocks**: None

## Overview

Wire up full work deletion from two entry points:

1. **Library view** -- via the "Delete" item in the book card actions menu (Task 0036)
2. **Book detail page** -- via a new delete button in the page header

The server action `deleteWork(id)` already exists in `src/lib/actions/works.ts`. The reusable `DeleteConfirmDialog` component already exists in `src/app/library/[slug]/delete-confirm-dialog.tsx`. This task wires them together from both surfaces.

## Implementation Details

### 1. Delete from Library View (Card Actions Menu)

**File: `src/components/books/book-card-actions-menu.tsx`**

When the "Delete" menu item is clicked:
1. Close the dropdown menu
2. Open a `DeleteConfirmDialog` (rendered inside the `BookCardActionsMenu` component)
3. Dialog shows:
   - Title: "Delete work"
   - Description: "Are you sure you want to delete this work? This action cannot be undone."
   - Item name: the work title
   - Cascade message: "This will permanently delete all editions, instances, and media associated with this work."
4. On confirm: call `deleteWork(workId)`
5. On success: show toast "Work deleted", call `router.refresh()` to re-render the library grid
6. On error: show error toast, close dialog

### 2. Delete from Book Detail Page

**New file: `src/app/library/[slug]/work-delete-button.tsx`**

`"use client"` component:

```typescript
interface WorkDeleteButtonProps {
  workId: string;
  title: string;
}
```

Renders:
- A `Trash2` icon button (ghost variant, danger on hover) in the work detail page header
- Positioned next to the existing edit button (pencil icon from `WorkEditDialog`)
- On click: opens `DeleteConfirmDialog` with same cascade warning as above
- On confirm: calls `deleteWork(workId)`
- On success: toast "Work deleted", `router.push("/library")` (redirect to library since the work no longer exists)
- On error: error toast, close dialog

**File: `src/app/library/[slug]/page.tsx`**

- Import and render `WorkDeleteButton` next to the `WorkEditDialog` in the header actions area
- Pass `workId` and `title` as props

### Cascade Behavior

`deleteWork` cascades through the database schema:
- `editions` have `ON DELETE CASCADE` from `works`
- `instances` have `ON DELETE CASCADE` from `editions`
- `work_authors`, `work_subjects`, and all taxonomy junction tables cascade
- `media` table entries cascade
- S3 media files are NOT automatically deleted (acceptable for now -- orphan cleanup is a separate concern)

The cascade warning in the dialog should be dynamic if possible:
- Count editions and instances from the data already available on the page
- e.g., "This will also delete 3 editions and 5 instances."

### Files

| File | Change |
|---|---|
| `src/components/books/book-card-actions-menu.tsx` | Wire Delete menu item to DeleteConfirmDialog + deleteWork action |
| `src/app/library/[slug]/work-delete-button.tsx` | New: delete button for book detail page header |
| `src/app/library/[slug]/page.tsx` | Add WorkDeleteButton to header actions |

## Completion Notes

Both deletion entry points are now wired up:

1. **Library view (card actions menu)** -- already implemented in Task 0036 via `book-card-actions-menu.tsx`. Not modified in this task.
2. **Book detail page** -- new `WorkDeleteButton` component (`src/app/library/[slug]/work-delete-button.tsx`) renders a ghost Trash2 icon button next to the edit button in the page header. On click it opens `DeleteConfirmDialog` with a dynamic cascade message showing the number of editions and instances that will be deleted. On confirmation it calls `deleteWork()`, shows a success toast, and redirects to `/library`.

Files changed:
- `src/app/library/[slug]/work-delete-button.tsx` (new) -- client component with delete button and dialog wiring
- `src/app/library/[slug]/page.tsx` -- imported `WorkDeleteButton`, wrapped header actions in a flex container with edit and delete buttons side by side

Typecheck passes.

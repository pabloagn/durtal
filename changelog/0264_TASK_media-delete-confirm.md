# Task 0264: Confirm Before Deleting an Image

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
People delete images in two dialogs: `MediaManagerDialog` (books, book cards,
collections, perfumes, perfume formulations) and `AuthorMediaManagerDialog`
(author page). Both deleted at once, with no confirmation, for one image and
for "Delete selected". A delete cannot be undone: `deleteMedia` and
`bulkDeleteMedia` remove the row, then remove its files from storage when no
other record uses them. Both dialogs now ask first.

Follow-up to SLN-391. PR #4 replaces `confirm()` in `MediaGallery`, but no page
renders `MediaGallery` since `f4a37cf`.

## Implementation Details
- Both dialogs keep a `pendingDelete` state: one image (`single`) or the
  selection (`bulk`). The trash button and "Delete selected" set it. The
  existing `DeleteConfirmDialog` (`src/app/library/[slug]/delete-confirm-dialog.tsx`)
  opens, and only its Delete button runs the delete.
- The confirm renders beside the media dialog, not inside it. React passes a
  child dialog's `cancel` event (Escape) up the component tree, so a nested
  confirm would close the media dialog too.
- Wording: "Delete image" or "Delete images", and "This cannot be undone."
- The shared `Dialog` is unchanged. Focus return on close belongs to task 0263.

## Completion Notes
Checked on a local copy of the newest backup (`scripts/qa/preview-local.py
--from-dump`), with no storage settings. The storage cleanup failed with
"Resolved credential object is not valid", so no file was touched.

- Book page (`MediaManagerDialog`): Enter on a trash button opens the
  confirm. Escape and Cancel close only the confirm, and nothing is deleted.
  Tab stays in the confirm. Delete removes the image ("Media deleted").
- Author page (`AuthorMediaManagerDialog`): "Delete selected" with 2 images
  opens "Delete images / 2 images". Cancel keeps the images and the
  selection. Delete removes both ("Deleted 2 items").
- 390px: the confirm spans 6px to 384px and both buttons are in view. The
  pages themselves are wider than 390px on main, so the page overflow was
  hidden for this measure.
- Alignment audit: 0 deviations, with the media dialog open and with the
  confirm open. Design audit: 0 low-contrast, 0 unnamed. The one nested
  control (Export) is on main already, and PR #4 fixes it.
- After the confirm closes, focus goes to the page body, not back to the trash
  button. The shared `Dialog` unmounts without `close()`, and task 0263 fixes
  that.

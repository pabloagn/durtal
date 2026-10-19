# Task 0811: Media uploads checked first, a keyboard drop zone, tabs that say which is chosen, plainer words

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-903 to SLN-906, from the media editor survey (`findings/`).

## Implementation Details
- SLN-903: `imageFileRefusal()` and `IMAGE_ACCEPT` in
  `src/lib/validations/media-security.ts`. The upload zone refuses a file over
  50 MB or of a type other than JPEG, PNG, WebP or GIF before sending it, and
  its file picker lists only those four types. The upload and edition cover
  routes refuse with the same messages. `readableImage()` in
  `src/lib/media/ingest.ts` refuses a file that claims an image type but cannot
  be read ("This file is not an image Durtal can read.") with a 400, rather than
  a server error.
- SLN-904: the drop zone (`upload-zone.tsx`) is a real button: Tab reaches it,
  Enter or Space opens the file picker, and it has a name. The hidden input sits
  outside it.
- SLN-905: the Manage media tabs are a `SegmentedControl` (a radio group named
  "Images"), so the chosen one is announced and arrow keys move between them.
- SLN-906: a painting's main image is called "Image", not "Poster"
  (`mainImage="image"` from `painting-actions.tsx`). Toasts say "Could not ..."
  instead of "Failed to ...", deletions say "Image deleted" / "Deleted N
  images", sizes read "1200×1800" and the URL field's placeholder ends in an
  ellipsis.

- From the review of #459 (`findings/review-pr-459.md`, notes 1 and 2):
  - `surface-state.ts`: a closed surface hands its focus origin to one that
    opens as it closes only until the focus next lands somewhere. Delete image
    pressed within a frame of Keep editing (Firefox) opened its confirm with
    Done as its origin, so Escape returned the focus to Done.
  - Each poster thumbnail is named by its place and state: "Poster 2 of 3,
    active".
- The Images tabs keep #459's question: a change of tab with unsaved
  adjustments asks first.

## Completion Notes
- `media-upload-tabs-words.test.ts` covers the refusals, the accept list, the
  keyboard button, the tab radio group, the painting wording, the focus
  hand-over and the thumbnail names.

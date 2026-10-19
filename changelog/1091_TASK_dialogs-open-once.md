# Task 1091: A reading dialog opens once, and the toasts stay put when no toast is up

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
From the slow-device survey (SLN-1464, finding 2). On a phone at 4x CPU, Log progress opened "Loading reading action…" as a modal, closed it, then opened the real dialog: two modals and two focus moves for one tap. Every dialog that opened also made the toast layer hide and show itself again, a style recalculation of 290 to 570 ms on that phone, even with no toast on screen.

## Implementation Details
- `src/components/ui/feature-renderer.tsx`:
  - A renderer that has loaded is kept by its loader, so the next open renders it at once, with no loading stage.
  - `preloadFeature(load)` starts a load before the open. An open during that load waits on the same one; a failed preload is tried again by the open, which still offers Retry if that fails too.
  - "Loading reading action…" shows only once the load takes longer than `PENDING_DELAY_MS` (300 ms). Until then nothing opens and the focus stays on the button, while the surface is held, so Escape still cancels. A failure shows at once.
  - When one loading stage hands over to the next within the same open (the reading host, then its dialog; a failure, then its Retry), the next keeps the first one's clock, and shows at once if the first had shown.
- `src/components/reading/reading-dialogs-provider.tsx`: the dialog's own code starts loading with its host and data, instead of after them.
- `src/components/reading/reading-provider.tsx`: once the book page is idle, it preloads the dialog its main action opens: Log progress for a book being read, else Start reading.
- `src/components/layout/app-toaster.tsx`: the toasts move over a dialog only while a toast is showing. With none, they stay where they are, and the layer is shown again only after a move (which hides it). A toast that arrives while a dialog is open moves them over the top dialog before it paints.

## Completion Notes
- `dialog-open-once.test.ts` (new): a preloaded dialog opens first time with one modal and one focus move; a load within the delay shows no loading modal; a slow one shows it after the delay, and Escape cancels before; a preload under way is shared with the open; a failed preload is loaded again. All four fail with main's renderer.
- `book-page-dialog-preload.test.ts` (new): the idle book page loads Log progress for a book being read, and Start reading otherwise.
- `app-toaster.test.ts`: a dialog opening with no toast makes no popover call; a toast up first, or arriving later, sits in the dialog with its layer shown. Both fail with main's toaster.
- `reader-dialog-chunks.test.ts` and `reader-secondary-renderers.test.ts` wait past the delay before they look for the loading modal.

# Task 0558: Toast lifecycle, speech and placement

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0528 (toast dismiss cross), 0529 (notification history)
**Blocks**: None

## Overview

SLN-732, the rest of SLN-567. Changelog 0529 listed what was still open: the lifecycle across producers, live announcements and reduced motion, and a dialog and reader layout pass.

Before:
- Every toast lasted four seconds, errors included.
- The same event twice made two toasts.
- A long export or bulk change said nothing until it ended.
- Toasts were read as one stream by Sonner's own live region, errors politely.
- A toast raised while a dialog was open sat under the dialog's veil, where it could not be dismissed.
- In the reader, toasts covered the bottom bar.

## Implementation Details

- **One way to make a toast** (`src/lib/notifications/toast.ts`). The 122 files that imported `toast` from `sonner` import it from here. It has the same calls, plus `toast.pending`.
  - **Expiry per kind** (`TOAST_DURATION`): success and info 4s, warnings 8s. Errors stay until dismissed.
  - A toast with an action (Undo, Retry, Review) or its own duration keeps exactly what it asks for, as before.
  - **A repeat** of the same kind and text, while that toast is on screen, returns the same toast: no second toast and no second announcement. The toaster reports what it shows (`syncShownToasts`), so a toast left behind by a layout change (the library to the reader) never swallows a later one.
  - **Info is one look**: `toast.message` and plain `toast()` are info toasts. The four `toast.message` callers now call `toast.info`.
  - **Pending to outcome** (`toast.pending(message)`): a loading toast whose `success`, `error`, `info` or `warning` replaces it under the same id. Sonner fixes a toast's lifetime when it first appears, so the pending toast starts with a success's four seconds. A failure (or a warning) after the wait is set to stay until dismissed.
- **Producers with a pending toast**:
  - exports from the Export menu, from a detail page's Actions menu, and from Settings, Data;
  - the library selection bar's bulk status, priority, marks and Up Next;
  - the bulk favourites menu;
  - every selection bar's bulk delete;
  - reprocessing an author image.
- **The toaster** (`src/components/layout/app-toaster.tsx`):
  - **Icons**: Lucide at 16px and 1.5px stroke. Success and info are in the secondary colour, warnings in gold, errors in `accent-red-text`. The loading icon spins only without reduced motion.
  - **Speech** (`ToastAnnouncer`): Sonner's list is no longer a live region. Two hidden regions say each toast once, oldest first: errors assertively, everything else politely.
    - A pending toast says its message, then its outcome.
    - A repeat, or a toast that only re-renders, says nothing.
  - **Focus** (`ToastFocus`): a toast dismissed from the keyboard, by its cross or its action, moves the focus to the next toast's cross, or the one before. With none left, the focus goes back where it was before it entered the toasts.
  - **Over dialogs** (`useLayerHost`): the toasts are a `popover="manual"` layer, so they sit in the top layer.
    - A modal dialog makes the rest of the page inert, so while one is open the layer moves inside it. The toasts can then be dismissed, and their Undo used, over the dialog.
    - The layer is shown again after each move, so it stays above the dialog. When the dialog closes it comes back to the page.
  - **Placement** (`useClearance`): toasts keep 16px plus the safe-area inset from the bottom. They sit 12px above any bar under their column:
    - the reader's bottom bar (`data-reader-bottom-bar`), which keeps its place while hidden so toasts don't jump;
    - a selection toolbar, or the timer's unavailable notice (`data-toast-avoid`).
  - No reader file changed.
- `src/components/ui/tooltip.tsx`: the toasts' layer, always open, does not count as a layer an Escape closes.
- Reduced motion: Sonner already drops its transitions under `prefers-reduced-motion`. Timers already hold while the stack is hovered or focused.

## Completion Notes

- **Tests** (`src/__tests__/ui/toast-lifecycle.test.ts`):
  - pending to success, and pending to failure (which stays);
  - each kind's duration, with action toasts left as asked;
  - three toasts arriving together, each said once and in order, the error assertively;
  - a duplicate event;
  - dismissing the middle toast from the keyboard;
  - a toast arriving while the page changes.
- Tests that mocked `sonner` for a producer now mock `@/lib/notifications/toast`. Mocks that offered `message` also offer `info`.
- **Browser checks** were run on a production build with the seeded preview, in Chromium, Firefox and WebKit at 1440, 768, 390 and 320, with reduced motion. Each check showed one toast, three toasts (a short success, a long error and an info toast with a description), and a pending toast settling.
  - **Places covered:**
    - the library;
    - the New collection dialog;
    - the reader with its bars up;
    - the library's selection bar.
  - **Results** (144 runs, all clean):
    - The alignment, design and overflow audits found nothing in the toasts.
    - No toast leaves the screen or clips its text.
    - No toast covers a dialog button, the reader's bars or the selection bar.
    - Every toast sits at least 16px from the bottom edge.
    - Sonner's transitions are off.
  - **Clicks:** the front toast's cross takes a real click on the page, in the reader and over the open dialog, which stays open.
  - **Pending toasts:** a pending toast says "Exporting as CSV", then "Exported 12 books as CSV", as one toast. Its icon sits on the title's first line and does not spin under reduced motion.
- **Navigation:** a toast raised before a client navigation (the library to Collections) and one raised during it both stay and are each said once. This was checked in 11 of the 12 engine and width pairs. In WebKit at 768 the check could not reach the sidebar link.
- **Page weight:** every route is within budget.
- `pnpm typecheck` clean; `pnpm lint` adds no warning; `pnpm test:local`: 670 files, 7214 tests pass.

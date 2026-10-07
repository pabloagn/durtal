# Task 0369: The selection toolbar's Esc and tap areas

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Two problems on main around a list's selection toolbar, found by the merging
thread: Esc in a dialog or menu opened from the toolbar also left selection
mode and lost the chosen books (SLN-531), and three of the toolbar's buttons
were too small to tap (SLN-532).

## Implementation Details

- **SLN-531, Esc.** `useSelection` (`src/lib/hooks/use-selection.ts`) left
  selection mode on any Escape, from a listener on the document. A native
  dialog closes on Escape only after the keydown has passed the document, and
  a `DropdownMenu` marks its Escape handled in its own document listener,
  which ran after the selection's. The selection now listens on the window,
  after the document's listeners, and leaves an Escape alone when it is
  already handled or a dialog is open: one layer per Esc, as the menus already
  do. With nothing open, Esc still leaves selection mode. This holds for every
  list that uses the hook (books and people).
- **SLN-532, tap areas.** "Select all", "Deselect" and "Exit selection" in the
  toolbar (`bulk-action-toolbar.tsx`) take `touch-hit`: an invisible 44 px
  press area on a touch screen. The bar looks the same.

## Completion Notes

- `src/__tests__/hooks/use-selection.test.ts` (3): Esc with nothing open
  leaves selection mode and clears the choice; Esc inside an open dialog keeps
  the selection, and the next Esc after it closes leaves the mode; an Escape a
  menu has handled keeps the selection. The last two fail on main's hook.
- Production builds of main (2f2f2ee3) and this branch on the newest backup,
  in headless Chrome, WebKit and Firefox, at 1440 px with a mouse and 390 px
  with a coarse pointer, with two books selected on `/library` and real key
  presses:
  - On main, Esc in the Reading menu cleared the selection (2 books, then 0),
    and at 390 px `touch-audit.js` found "Select all" 60 by 20 px, "Deselect"
    58 by 20 px and "Exit selection" 22 by 22 px.
  - On this branch, Esc in the Reading menu and Esc in the Mark as read dialog
    each close their layer and keep both books; the next Esc leaves selection
    mode. At 390 px the touch audit finds nothing and no two `touch-hit` areas
    overlap. The alignment audit finds nothing at either width.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 257 files, 2,864 tests, all passed.

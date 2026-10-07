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
  which ran after the selection's. The selection now leaves an Escape alone
  when a dialog is open, or when another layer has handled it: one layer per
  Esc, as the menus already do. The command palette and the page's search
  field mark theirs in window listeners that are added again as they change,
  so they can come after the selection's: the selection reads the mark once
  the key has reached every listener (the next task). With nothing open, Esc
  still leaves selection mode. This holds for every list that uses the hook
  (books and people).
- **SLN-532, tap areas.** "Select all", "Deselect" and "Exit selection" in the
  books' toolbar (`bulk-action-toolbar.tsx`) and in the people's
  (`author-bulk-action-toolbar.tsx`) take `touch-hit`: an invisible 44 px
  press area on a touch screen. The people's bar also wraps onto a second row
  on a narrow screen, as the books' bar does (SLN-452): at 390 px it ran from
  -124 to 514 px, with Delete and Exit selection off the screen.

## Completion Notes

- `src/__tests__/hooks/use-selection.test.ts` (4): Esc with nothing open
  leaves selection mode and clears the choice; Esc inside an open dialog keeps
  the selection, and the next Esc after it closes leaves the mode; an Escape a
  menu has handled keeps the selection; an Escape a window listener added
  after the selection's handles (the command palette) keeps it too. The last
  three fail on main's hook.
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
- Review's fixes, in headless Chrome with real key presses on `/library` and
  `/people`: Esc in the command palette, and Esc in the search field after the
  palette has opened and closed, each closed their layer and kept the
  selection (on main and before the fix, both cleared it). At 390 px with a
  coarse pointer, the people's bar stays inside the screen and the touch
  audit finds nothing on it.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 257 files, 2,864 tests, all passed.

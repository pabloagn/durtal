# Task 0641: Enter never merges people or taxonomy items

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Second main audit, finding 1 (`findings/audit-2-2026-10-15.md`). In Merge
people, once a duplicate was picked, a plain Enter merged it and deleted the
duplicate for good, as did ⌘Enter. The dialog says "This cannot be undone",
and the keyboard rules say Enter never presses a danger action. Merge item
(taxonomy) had the same Merge as a form's submit button, so an Enter in its
search could submit it.

## Implementation Details

- `author-merge-dialog.tsx`: Merge is `variant="danger"`. The shortcut
  machinery presses only a primary or `data-shortcut="save"` button, so
  Enter and ⌘Enter now do nothing there; Merge takes a click, or Tab then
  Enter, like Delete.
- `merge-dialog.tsx`: the `<form>` is gone and Merge is a danger
  `type="button"` with its own click, so no Enter submits it.
- Picking a duplicate removes its row from the results, which dropped focus
  on the page body. Focus now goes back to the search, so the next name can
  be typed at once.
- On touch, the search field and every result row are 44px
  (`pointer-coarse:h-11`, `pointer-coarse:min-h-11`); the taxonomy results
  rows too. A picked chip's Remove cross was 12px on touch and, when a long
  name wrapped at 390, sat 10px below the name's first line. It now follows
  `PublisherChip`: `CapAligned` with a 44px box on touch, on the first line.
- `docs/15_KEYBOARD.md`: both dialogs are Confirm rows whose Merge Enter
  does not press.
- Test: `src/__tests__/ui/merge-dialog-keys.test.ts`.

## Completion Notes

- Measured before the fix on the audit preview in Chromium, Firefox and
  WebKit: with one duplicate picked, Enter on the dialog sent the merge
  request, and so did ⌘Enter; after a pick, focus was on the page body.
- With the fix, in Chromium, Firefox and WebKit at 1440, 390 and 320:
  Enter in the search, Enter on the dialog and ⌘Enter send nothing in Merge
  people; focus is in the search after a pick; clicking Merge still merges.
  In Merge item, Enter in the search and ⌘Enter send nothing (⌘Enter merged
  on main), a click merges, and the target rows are 44px on touch (36px on
  main). The touch and alignment audits are clean with both dialogs open,
  a duplicate picked; the chip's cross is on the name's first line.
- Audits on the person page and a taxonomy family in three engines at 1440,
  390 and 320: alignment, overflow, design and touch clean. The layout
  audit's "plain-looking" item names on the family page are on main too.
  `page-weight.js` passes. Typecheck clean, lint no errors, UI tests pass
  (94 files). No migration, no new package.

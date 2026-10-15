# Task 0650: Focus stays in the dialog after a busy add

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0649
**Blocks**: None

## Overview

Review of #337 (`findings/review-pr-337.md`). After a pasted URL was added
in Edition cover, the focus fell to the page body, so the next Enter or
⌘Enter did nothing until Tab. The field and its Add are disabled while the
add runs, and a disabled control drops the focus. Manage media's pasted
URL and the Collections dialog's "Find or create a collection" do the same.

## Implementation Details

- `src/hooks/use-focus-through-busy.ts` (new): when a busy add ends with
  the focus lost (on the page body or the dialog itself), the focus goes
  back to the control that had it when the add began, or, when that control
  is still disabled (an emptied field's Add), to the field, ready for the
  next one. Focus the reader moved elsewhere during the add stays there.
- Used by `edition-cover-dialog.tsx`, `media-manager-dialog.tsx` and
  `add-to-collection-dialog.tsx`, each with its field's ref.
- Manage media's URL field had no label; it is "Image URL", as in Edition
  cover.
- Test: `src/__tests__/ui/focus-through-busy.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database in
  Chromium, Firefox and WebKit at 1440 and 390 (touch below 800), adding
  by Enter, ⌘Enter (Ctrl+Enter off a Mac) and a click on Add, with each
  write held 700ms:
  - before (main): after every add in all three dialogs the focus was on
    the page body;
  - after, with the write failing (the text stays): the focus is back on
    the field after Enter and ⌘Enter, and on Add or "Create & add" after a
    click;
  - after, with the write succeeding (the field empties, so its Add is
    disabled): the focus is on the empty field after all three, in Edition
    cover and Manage media. Collections' create is a server action, so only
    its failure path was measured in the browser; the unit test covers the
    emptied case.
- Edition cover's Done, Enter, Esc and ⌘Enter behave as in 0649, and its
  alignment, touch and overflow audits are clean at 1440 and 390.
- `page-weight.js` passes. Typecheck clean, lint no errors, UI tests pass
  (106 files). No migration, no new package.

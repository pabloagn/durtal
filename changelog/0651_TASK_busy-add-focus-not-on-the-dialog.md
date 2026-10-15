# Task 0651: After a busy add, the focus goes to the field, not the dialog

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0650
**Blocks**: None

## Overview

Review of #343 (`findings/review-pr-343.md`). The hook from 0650 puts the
focus back on whatever had it when a busy add began. In Safari a mouse click
does not focus a button, so after a click on Add with the focus on the
dialog itself, the focus went back to the dialog, not the field: Enter then
pressed Done instead of adding the next one.

## Implementation Details

- `src/hooks/use-focus-through-busy.ts`: the dialog itself is never a
  control to go back to; the focus goes to the field instead.
- Test: `src/__tests__/ui/focus-through-busy.test.ts`.

## Completion Notes

- Headless browsers focus a button on click, so Safari's click was
  measured as a click that leaves the focus where it is (`element.click()`
  with the focus on the dialog), in Edition cover at 1440, a held write:
  - before (0650): the focus ended on the dialog in WebKit, Chromium and
    Firefox;
  - after: on the Image URL field in all three.
- The busy-add checks from 0650 are unchanged in all three dialogs, in
  three engines at 1440 and 390 (Enter, ⌘Enter, a click).
- Typecheck clean, lint no errors, UI tests pass. No migration, no new
  package.

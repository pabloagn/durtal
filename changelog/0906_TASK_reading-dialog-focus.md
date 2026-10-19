# Task 0906: Focus comes back after Log progress, Log a past read and Edit goals, and those dialogs start in their first field

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0905
**Blocks**: None

## Overview

SLN-1094, item 2 of `findings/reading-survey-2026-10-18.md`:

1. After Log progress, the focus landed on the body.
2. After Log a past read, the focus landed on the body.
3. After Escape on the hub card's Edit goals, the focus landed on the body.
4. The goal dialog, and Log a past read once a book was chosen, started with
   the focus on the dialog itself.

## Implementation Details

- **Log and Log read**: fixed by 0905's change to `ReadingDialogsProvider`.
  It restores the focus once the dialog is gone, not while the modal dialog
  still makes the page inert. The focus goes back to the button that opened
  the dialog: Log progress, or Log a past read through its book picker.
- **Edit goals** (`goal-dialog-button.tsx`):
  - **The cause.** The dialog's code loads when it opens, and the loading
    suspended the nearest Suspense boundary on the page. React hid the page
    while it loaded, the focused Edit goals button with it, so the focus fell
    to the body. The dialog then had no control to go back to.
  - **The fix.** The lazy dialog has its own Suspense boundary. Every opener
    keeps the focus, so Escape and Save return to it: the hub card, the hub's
    Goals menu, Settings and Stats.
- **Where a dialog starts** (`dialog.tsx`):
  - A dialog may mark the control it starts in with `data-autofocus`, the
    control itself or a wrapper around it. The mark wins over the first
    field.
  - It works when the dialog opens, and when its fields arrive after it
    opens.
  - The goal dialog marks its first goal, under the year.
  - Log a past read marks its Started date, under the outcome and the
    edition, copy, format and home lists.
  - Dialogs without the mark are unchanged.

## Completion Notes

- **In the browser** (private preview), Chromium, Firefox and WebKit at 1440,
  and at 390 with touch:
  - After Log progress, the focus is on the card's Log progress. On main it
    was on the body.
  - After Log a past read, through the picker and the possible-duplicate
    notice, the focus is on Log a past read.
  - After Escape on the hub card's Edit goals, the focus is on Edit goals. On
    main it was on the body. From the hub's Goals menu, it is on the menu's
    button.
  - The goal dialog starts in the first goal. Log a past read starts in the
    Started date's first control.
- **Audits**:
  - The interaction audit passes `/reading`, `/reading/stats` and
    `/reading/journal`, opening 55 dialogs, with no failure.
  - The browser audit passes 12 of 12 loads of `/reading` and
    `/reading/stats`.
  - Page weight passes every route.
- **Tests** (`ui/dialog-late-fields`): a dialog starts in the marked control
  inside a wrapper, under a list. A marked field that arrives late starts the
  dialog even under other controls. The UI tests pass (201 files).

# Task 0649: Edition cover shows Done

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Third main audit, finding 2 (`findings/audit-3-2026-10-15.md`). The cover
dialog on a book page applies every change at once (an upload, a pasted URL,
the book's cover), so it had only secondary and ghost buttons, and Enter and
⌘Enter did nothing. Other dialogs with nothing to save show Done (SLN-634).

## Implementation Details

- `edition-cover-dialog.tsx`: the dialog takes `done`, so Done is its main
  button and Enter closes it, as Esc does.
- The pasted URL's Add is the dialog's save (`data-shortcut="save"`), so
  ⌘Enter in the URL adds it and keeps the dialog open, as a Done dialog's
  own field does (Collections, Manage media). With a URL typed and not
  added, Done asks before dropping it, as Esc already did.
- Test: `src/__tests__/ui/edition-cover-done.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database in
  Chromium, Firefox and WebKit at 1440, 390 and 320 (touch below 800), with
  writes held and aborted:
  - Done is the dialog's primary button. Enter on the dialog closes it and
    focus goes back to Cover; Esc still closes it in one press. On main,
    Enter did nothing.
  - ⌘Enter (Ctrl+Enter off a Mac) in a pasted URL sends the cover request
    and the dialog stays open.
  - Alignment, touch and overflow audits are clean. In one WebKit run of
    four at 1440, "Or paste image URL" read 0.56px off: the half-pixel
    dialog top recorded in the second audit (finding 4), where every
    cap-aligned icon in the dialog moves together.
- `page-weight.js` passes. Typecheck clean, lint no errors, UI tests pass
  (104 files). No migration, no new package.

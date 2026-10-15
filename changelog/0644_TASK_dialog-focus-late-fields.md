# Task 0644: Edit person starts in Name; Catalogue status takes ⌘Enter

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-736, second main audit findings 5 and 6 (`findings/audit-2-2026-10-15.md`).
Edit person loads the person after it opens. The dialog focuses its first
field on open, but there was none yet, so focus stayed on the dialog and
typing did nothing until a click. Catalogue status ("Mark book
accessioned…") opened with Close and "Preview accessioned status", both
secondary, so Enter and ⌘Enter did nothing on its first step.

## Implementation Details

- `src/components/ui/dialog.tsx`: when a dialog opens with no field, it
  watches its contents; once a field arrives and focus is still on the
  dialog itself, focus moves to that field. If the person has moved focus
  inside the dialog by then, it stays where they put it. Every dialog that
  loads its fields after opening gets this, not only Edit person.
- `work-review-dialog.tsx`: "Preview accessioned status" is the primary
  button until the preview shows; then "Confirm status change" is. They
  never show together. The preview writes nothing.
- `docs/15_KEYBOARD.md`: Catalogue status is a step form whose Enter
  presses Preview, then Confirm.
- Tests: `dialog-late-fields.test.ts` (fails without the change) and a
  case in `work-review-dialog.test.ts`.

## Completion Notes

- Measured on the audit's build of main in Chromium, Firefox and WebKit:
  Edit person opened with focus on the dialog, and Catalogue status listed
  no main button.
- With the fix, at 1440 and 390 in all three engines: Edit person opens
  with focus in Name and typing goes there. ⌘Enter in Catalogue status
  shows the preview (one read request), and "Confirm status change" is
  then the primary button.
- The second-audit dialog checks on the person and book pages, in three
  engines at 1440, 390 and 320: focus, Escape and focus return pass, and
  nothing new appears in the alignment, touch or overflow audits. Merge
  people's 36px search is fixed in #323. `page-weight.js` passes.
  Typecheck clean, lint no errors, UI tests pass (96 files). No migration,
  no new package.

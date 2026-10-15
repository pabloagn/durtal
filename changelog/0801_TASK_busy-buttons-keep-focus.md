# Task 0801: A busy button keeps the focus

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-853. Focus survey, cause 2 (`findings/focus-survey-2026-10-15.md`).

A focused button that turns `disabled` drops the focus onto the page in every browser: the next Tab starts again from the top. Buttons that disable themselves while they work did this in place:
- the book page's favourite star, "Mark as rare" and "Mark as anathema", and their undo labels;
- a collection's favourite star;
- an e-book's "Unlink…" while the link loads;
- Settings > Data: every Download, and Refresh;
- Settings > Integrations: Check again;
- the book page's Export while the file is made;
- Edit person: Save changes, so the dialog had nothing to hand back.

## Implementation Details
- `src/components/ui/button.tsx`: `busy` no longer sets `disabled`. A busy button is `aria-disabled="true"`, looks as a disabled one does (`aria-disabled:opacity-40`, no pointer events), and its click handler ignores presses: it neither runs the action again nor submits its form (Enter in a field presses the submit button, and that press is cancelled too). A button that is `disabled` for its own reason stays disabled. The Button has a click handler of its own only while busy, so a server component's Button (a form's submit) still renders.
- The hand-made toggles do the same: `favourite-toggle.tsx`, `mark-toggle.tsx` (the mark and its card's undo), and the inline "Unlink…" (`unlink-ebook-button.tsx`), which `open` already guards while its dialog is up.
- Refresh and Check again use `busy` instead of `disabled`. Export uses `busy`, which swaps its icon for the spinner as every busy button does.
- The keyboard shortcuts already treat `aria-disabled="true"` as off (`shortcuts.ts`, `usable`), so ⌘Enter never presses a busy Save.
- Tests: `src/__tests__/ui/button-busy.test.ts` (a focused busy button keeps the focus, and a press neither acts nor submits), `unlink-dialog-host.test.ts`.

## Completion Notes
See the PR for the browser checks.

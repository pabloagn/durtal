# Task 0754: Edit dialogs keep Cancel and Save in view

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-847. Design polish pass 5, item 1 (`findings/design-polish-5-2026-10-15.md`).

- Edit work, Edit person and Edit venue wrapped their fields in a scroller of their own (`max-h-[75vh]`) inside the dialog, which scrolls already. On a phone the footer fell below the dialog's edge with only the top half of Cancel and Save showing, and a swipe moved one scroller or the other.
- Edit edition, Add and Edit copy, Edit film, Edit perfume and Edit painting put Save after the whole form, out of view until the end.
- Edit organization's Save sat 135-182px down its scroll at 768-1180px and below the fold at 390x844 (`findings/mid-width-survey-2026-10-16.md`, item 2).

## Implementation Details
- `src/components/ui/dialog.tsx`: `DialogFooter`. In a dialog, a form's Cancel, Save and notice go to a row under the scrolling body, outside it, as the dialog's own Done does: the fields scroll and the footer stays in view. The row is a portal target in the dialog; the body's bottom padding gives way to its rule. Outside a dialog (the film, perfume and painting forms on their own "new" pages) the row follows the fields as before (`outside` sets its spacing there).
- A native submit in the row names its form (`form`), since the row is not inside it: `edition-form.tsx`, `organization-dialog.tsx`.
- The inner scrollers are gone: `work-form.tsx`, `author-form.tsx`, `venue-create-dialog.tsx`, the edition and copy dialogs, and Edit taxonomy, which had the same pattern.
- Footers moved: the work, person, venue, edition, copy (add, edit), taxonomy, film, perfume, painting and organization forms. A copy's eBook review keeps its own controls in the body.
- Test: `src/__tests__/ui/dialog-footer.test.ts`.

## Completion Notes
See the PR for the browser checks.

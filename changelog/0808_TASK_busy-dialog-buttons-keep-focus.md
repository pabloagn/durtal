# Task 0808: Busy dialog buttons keep the focus too

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0801
**Blocks**: None

## Overview
SLN-867. The review of #423 (`findings/review-pr-423.md`): since 0801 a busy `Button` reads as off without being `disabled`, so it keeps the keyboard focus. Buttons that still passed their own busy flag to `disabled` dropped the focus to the page while they worked, mostly dialog main buttons.

## Implementation Details
The busy flag leaves `disabled` in:
- the delete confirmations: a book's (`delete-confirm-dialog.tsx`), an order's (`order-detail-panel.tsx`), a collection's (`collection-controls.tsx`), a taxonomy family's and item's;
- the taxonomy create (family, item) and merge dialogs;
- Add books to a collection or a series, and New collection;
- Start reading's Find page count; the reading import's commit button;
- the e-book review's Confirm, the bulk dialog's Apply and a recent decision's Undo, and a series suggestion's Link (each now disabled only while another action runs).

Their other conditions (no name yet, nothing picked) still disable them. `docs/03_DESIGN_LANGUAGE.md` (busy controls) said a busy button "is disabled"; it now says it reads as off and is never `disabled`.

## Completion Notes
- Test: `src/__tests__/ui/busy-not-disabled.test.ts` reads every `<Button>` and fails on one whose `disabled` holds its own busy flag (13 on main).

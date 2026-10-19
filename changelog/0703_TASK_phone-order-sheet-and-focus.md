# Task 0703: The order panel as a sheet on phones, and where the focus goes

**Status**: Completed
**Created**: 2026-10-18
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1118, from the recommenders and acquisitions survey (findings/recommenders-acquisitions-survey-2026-10-18.md, items 1 and 3). Opening an order on /provenance put its 320px panel beside the board at every width. At 390 the board was 8px wide, its cards one letter a line; at 320 it was 0px and the panel ran 40px past the screen, so the page scrolled sideways and the panel's Close button was cut off. Deleting an order dropped the focus to the page body, and the inline delete question did not take the focus.

## Implementation Details

- `app/(catalogue)/provenance/provenance-shell.tsx`: from lg (1024px, read with `useSyncExternalStore` over `matchMedia`) the panel stands beside the board as before. Under it the panel is a sheet over the board: `glass`, fixed below the phone's bar (`top-12`) and beside the sidebar from md, square-cornered, `overflow-hidden` with the panel's own body scrolling. The board is `inert` while the sheet is open. At 768 a board beside the panel would have been about 340px wide, so lg rather than md is the line.
- Focus, applied in an effect once the panel has gone (a card under the inert board refuses it sooner):
  - closing (Close or Escape) returns it to the order's card, found by `data-order-card` on the board's cards and on the in-person and auction rows;
  - deleting moves it to the next card, else the one before, else New order (`data-focus-empty="orders"` on the header's button in `order-create-dialog.tsx`).
- `order-detail-panel.tsx`: the sheet focuses the panel's heading when it opens (`takeFocus`). The delete question is a labelled group that takes the focus on Cancel; answered No, the focus goes back to Delete order. A delete reports `onDeleted` apart from `onClose`, and resets only on an error.
- After Create order the focus already returned to New order (the dialog's origin); no change was needed there.

## Completion Notes

- Browsers (preview with the reader seed; creates an order through New order, then opens, closes and deletes it): Chromium 1440 and 1024, Firefox 768 and 320, WebKit 390. No sideways scroll at any width; the sheet spans the screen under the bar on phones and the content area at 768. Focus: heading on open as a sheet, card after Escape or Close, Cancel when the question opens, Delete order after Escape on the question, next card after a delete, New order after the last.
- Alignment audit with the panel open, Chromium, Firefox and WebKit at 1440, 1024, 768, 390 and 320: 0 issues, overflow 0.
- `page-weight.js`: exit 0, /provenance 59 KB.
- Tests: `src/__tests__/provenance/order-sheet.test.ts`.

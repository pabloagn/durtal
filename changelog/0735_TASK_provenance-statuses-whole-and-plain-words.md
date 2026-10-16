# Task 0735: Provenance shows every status whole, in plain words

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-833, design-polish pass four item 5 (`findings/design-polish-4-2026-10-15.md`).
"Active Pipeline" was a board of seven columns that scrolled sideways and cut
its last column at every width ("DELIV" at 1440), and "OUT FOR DELIVERY" ran
into its count ("DELIVERY0"). The tiles spoke in jargon ("non-terminal",
"shipped orders"), the button and headings were title case, and with no order
the page was four zeros over an empty board.

## Implementation Details

- `src/app/(catalogue)/provenance/provenance-shell.tsx`: "Orders in progress"
  lists one status a row, its orders side by side as many as fit (13rem each,
  the whole row on a phone). Nothing scrolls sideways. Dragging an order onto
  another status still moves it.
- `pipeline.tsx` (`PipelineColumn`): the status's label wraps whole words,
  with the dot on its first line (`CapAligned`) and the count apart from it.
  An empty status is its header alone. Order cards show the title, author and
  shop in full, instead of clamping or cutting them. A card is a column with
  its footer at the foot (`mt-auto`), so the cards of a row, stretched to the
  tallest, start their titles and end their footers on one line (a button
  centres its content otherwise).
- Tiles: "In transit" (Shipped, not yet here), "Arriving this week" (In the
  next 7 days), "Active orders" (Not yet delivered), "Total spent" (All time).
- With no order ever, one empty state says what an order is and points at
  New order. The acquisition history's own "No acquisitions yet" goes.
- Sentence case across the page and its dialogs: New order, Edit order, the
  status columns, the method options ("In-store purchase" too) and the form
  labels.
- docs/05 and docs/15 name the dialog "New order"; `scripts/qa/journeys.mjs`
  waits for "New order".
- Test: `src/__tests__/provenance/pipeline-and-words.test.ts`.

## Completion Notes

See the PR for the browser checks.

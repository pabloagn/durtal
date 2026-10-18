# Task 0711: Chart frames and thin-ring controls use the standard focus ring (SLN-873)

**Status**: Completed
**Created**: 2026-10-16
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Item 6 of the hover and focus survey (`findings/hover-focus-survey-2026-10-15.md`) found two problems with focus rings:
- A chart's frame showed a 1px ring at 60% that sat on its axis labels ("1823", "2022"), on the dashboard and on the reading statistics.
- Seven other controls outside the reader drew their own 1px ring instead of the house's 2px steel outline.

Now each of them shows the house outline, clear of the text and never clipped.

## Implementation Details
- `src/components/reading/charts/chart-frame.tsx`: the frame drops its ring and takes the global outline, with `focus-visible:outline-offset-4`. The outline stands 4px outside the frame, so it clears labels drawn at the frame's edges.
- `src/components/reading/charts/bar-chart.tsx`: the tick gutter and the label column fit their longest label, so no label starts outside the frame.
- The small icon buttons drop `focus-visible:ring-1` and take the global outline, inset with `focus-visible:-outline-offset-2`, as `action-control` does. Inside a cap box (`overflow: hidden`) or a dialog's scroll area, an outline that stands outside is clipped to 1px. The buttons are:
  - record fields' Remove;
  - a taxonomy chip's Remove;
  - Reorder families' Move up and Move down;
  - the film form's row buttons;
  - a film version's Remove release.
- The logo upload's drop zone, which sits full width in the media dialog, gets the same inset.
- The reader's progress scrubber keeps its ring; the reader is out of scope.
- Test: `src/__tests__/ui/standard-focus-ring.test.ts`. It checks that no file outside the reader uses `focus-visible:ring-1`, that the chart frame stands its outline off, that a bar chart fits its label column and gutter to its labels, and that the small controls inset theirs.

## Completion Notes
Measured on a production build in Chromium, Firefox and WebKit at 1440 and 390.
- **Chart frame.** It shows a solid 2px outline with a 4px offset, and no ancestor clips it. The nearest axis label is 4px from the outline (3px in Firefox); with the old ring it touched.
- **Bar chart labels.** The tick gutter and the phone's label column were fixed at 36px and 72px, so "2,000" on Reading by weekday and "800 or more" on Books by length in pages started left of the frame, under the new outline. Both now fit their longest label (`textWidth`, about 7px a character). Every chart label on the dashboard, Statistics and the reading statistics starts at or inside its frame, at most 1px out in Firefox, which leaves 3px to the outline, at 1440, 1024, 768, 390 and 320 in all three browsers. Found by the review of #490.
- **Reorder families.** Every Move button shows a solid 2px outline at -2px, unclipped by its cap box. In Firefox this was checked by tabbing through the dialog.
- **Audits.** Alignment is clean on /, /taxonomy, a film, a book, /reading/stats and an organization in all three browsers at 1440, 1024, 390 and 320. Page weight passes.

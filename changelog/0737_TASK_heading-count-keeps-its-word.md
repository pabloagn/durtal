# Task 0737: A heading's count stays with its word

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-835, design-polish pass four item 7 (`findings/design-polish-4-2026-10-15.md`).
At 390 a perfume's "Formulations (3)" shared its row with "Add formulation",
so "(3)" wrapped to a line of its own under "Formulations". Joris's rule for
phone headers: the controls go under the title when it won't fit.

## Implementation Details

- `src/components/shared/section-heading.tsx`: the count is joined to the
  title's last word by a no-break space and does not wrap
  (`whitespace-nowrap`). The title column's narrowest width (`w-min`) is then
  "Formulations (3)", so when that and the action do not fit one line the
  action wraps under the title (the rule the heading already had for a long
  word), and the count never sits alone.
- Every `SectionHeading` with a count gets this: 48 call sites (films,
  paintings, perfumes, book and edition cards, places, series, reading,
  e-books, the review queue, imports).

## Completion Notes

- Test: `src/__tests__/ui/section-heading-wrap.test.ts` (the count's no-break
  space and `whitespace-nowrap`).
- Measured: "Formulations (3)" is one line at 320, 390 and 1440; at 320 and
  390 Add formulation sits under it at the right edge, at 1440 beside it.
- Browsers: a perfume, film, painting, book, place, e-book, the review queue,
  Reading and the reading import page in Chromium, Firefox and WebKit at 1440,
  390 and 320: alignment, design, overflow, layout and touch audits clean.
- Page weight: every route within budget.
- Overlaps the Quick-win thread's SLN-827 (also SectionHeading): whichever
  lands second keeps both.
- Carries the one-line person page test fix from #406 so CI is green before
  that lands.

# Task 0347: Touch targets left after #117, and icon-hit in rem

**Status**: Completed
**Created**: 2026-10-06
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0340 (#117)
**Blocks**: None

## Overview

SLN-511. After #117 landed, `touch-audit.js` at 390px on a coarse pointer
still found controls under 44px on live data: 26 on `/reading/suggestions`
(controls from #122, which landed after #117's sweep) and 3 on a book page.
Review of #117 also found that `icon-hit` and `icon-hit-end` used px where the
classes they replaced used rem, so the favourite star did not grow with the
reader's font size (36px, not 40px, at a 20px default).

## Implementation Details

- `icon-hit`: padding 0.5rem, 0.875rem on touch; `icon-hit-end`: margin
  -0.5rem, -0.875rem on touch. The same 8 and 14px at the default 16px.
- `/reading/suggestions` and the hub's suggestions: a book title cuts off
  with `lines-1`, which clips its own overflow and so also clipped a touch
  area. The cut moves to a span inside the link, and the link takes
  `touch-hit` (the suggestion rows, the hub's three, the hidden list).
  "Hidden (n)", "See all", "Previous" and "Next" take `touch-hit`.
- Book page: the edition card's "Adjust edition cover" button, the publisher
  links (`EditionPublishers`) and the copy status button take `touch-hit`.
  Nothing moves on a fine pointer.
- Doc 03 notes the rem units and the `lines-1` case.

## Completion Notes
- Seeded preview (the reading journey's books, 40 more unread books for two
  pages of suggestions, a publisher and a cover on the journey book's
  edition): `touch-audit.js` at 390 on a coarse pointer finds 0 controls under
  44px on `/reading/suggestions` (24 rows), its page 2 (21 rows), `/reading`
  and `/library/journey-reading`, in headless Chrome, WebKit and Firefox.
- `alignment-audit.js` and `design-audit.js` on the same four pages at 1440,
  768 and 390: no finding.
- `python3 scripts/qa/test-local.py`: 223 files, 2,498 tests.

### Review fixes (PR #128)

- Publisher links that wrap on a phone sit 20px apart on a coarse pointer
  (`pointer-coarse:gap-y-5`), so their 44px press areas meet and no longer
  overlap the next line's; one line looks as before.
- The copy's location row wraps with 10px between its lines on a coarse
  pointer (`pointer-coarse:gap-y-2.5`), so the status button's press area no
  longer reaches into Edit and Delete.

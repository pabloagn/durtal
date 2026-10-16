# Task 0821: Touch press areas keep apart

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-862, from the touch-target survey (`findings/touch-targets-2026-10-15.md`).
On a phone every control's press area is 44px, but some crossed their
neighbour's, so a tap on one edge went to the other. A tap on the low edge of
a book's author toggled "Mark as rare", and "eBook details" sat 2px from
"Unlink…". Many shared controls also sat 0-4px apart. Every change applies
under a coarse pointer only, so desktop layouts are unchanged.

## Implementation Details

Press areas that crossed:
- Book page: the author line, the year and marks row and the Read row move
  down on touch, and the two marks are 8px apart.
- Book page copy row: "eBook details", Read and "Unlink…" are 16px apart, and
  wrapped rows are 38px apart. Edit and Delete instance are 8px apart, and the
  row below the status is 18px lower.
- eBooks: the state counts wrap 32px apart and sit 4px lower under the header.
- Painting and perfume facts (`dl`, the `facts-touch` utility): a row
  whose value holds a link gets 12px above and below, label too, so two
  linked rows are 32px apart, as is a linked first row from the title or
  house line. Plain-text rows and the rating keep the list's 8px, so the
  list does not read loose (review of #435). The perfume's formulation
  links are 26px apart in rows and 8px across.
- Taxonomy chips on record pages (`taxonomy-assignments.tsx`): a chip's
  cross stays inside it (`pr-4`), chips are 16px apart across and 26px
  between rows, and families are 26px apart.
- Rating: Clear is 8px from the stars.

Shared controls, `pointer-coarse:gap-2` (8px):
- view switch;
- Reading tabs, Settings tabs and the collection switch;
- list sort (select and direction);
- segmented control;
- dialog title bar;
- both rich-text toolbars;
- a card's corner actions (`artwork-actions`);
- suggestion and Reading row actions;
- collection and series row moves;
- edition actions;
- eBooks sort chips;
- the statistics Years/Decades toggle.

The phone header gives its buttons 8px on both sides, and the compact pager
keeps its 4px gap on fine pointers only.

## Completion Notes

- Measured with a spacing audit (every pair of visible controls whose
  touch-audit targets cross or sit under 8px apart). The pages were 27 list,
  record, reading, settings and statistics pages, including a book with a
  linked eBook. Browsers were Chromium and WebKit at 390 and 320.
- **Before:** 2,279 close pairs, with overlaps up to 16px between facts
  and 12px between the author and the marks.
- **After:** 1,316 close pairs. No two controls' press areas cross, except a
  card's star over its own title and cover links, and names in comma lists.
- **Left as they are:**
  - comma-separated name lists (text);
  - stacked full-width rows (menus, organizations, statistics lists);
  - a card's title link under its star, which the star wins by design;
  - the star 1-4px under a card's corner actions. Fixing that changes card
    proportions, so it needs its own decision.
- Tests: `src/__tests__/ui/touch-target-gaps.test.ts`. Updated the
  segmented-control, member-card and copy-ebook-links tests.
- Browsers: every touched page in Chromium, Firefox and WebKit at 1440, 390
  and 320, with the alignment, design, overflow, layout and touch audits.

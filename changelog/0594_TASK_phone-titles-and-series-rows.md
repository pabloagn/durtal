# Task 0594: Detail titles on a phone, and series rows with no author

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0591
**Blocks**: None

## Overview

Three findings of the main audit of 15 Oct 2026
(`/mnt/project-files/findings/main-audit-2026-10-15.md`):

1. At 320px a place title broke inside a word ("Shakespe / are"), as did a
   long museum and organization name: their controls stayed beside the
   title, which kept 180 of 288px.
3. A series book with no author put its badges 8px in from the title (an
   empty authors line and its gap), and the phone controls' first icon 14px
   in.
10. Page titles stayed 46px on a phone: an 80-letter title took 5 lines at
    390px and 7 at 320px, pushing the picture off the first screen.

## Implementation Details

- **1.** #293 (0591) gave places and organizations the book's `wide` title
  row, so on a phone a title that cannot sit beside the controls takes the
  row and the controls go under it. With the row's full width no word of the
  measured titles is split, in any kind.
- **10.** `DetailTitleRow` marks a title past 40 letters `long` and past 60
  `longer` (`data-title-length` on the row and the h1). Under `sm`,
  `globals.css` sets a long title at 38px and a longer one at 30px, the next
  steps of the type scale; shorter titles keep 46px, and every title keeps
  46px from `sm` up. Noted in `docs/03_DESIGN_LANGUAGE.md`, Typography.
  `layout-audit.js`'s squeezed rule allows such a title four lines on a phone
  rather than two.
- **3.** `series-books.tsx`: the authors line renders only when there are
  authors, and the phone controls row is pulled out by the first button's
  padding (`-ml-2.5`, `pointer-coarse:-ml-3.5`).

## Completion Notes

- Titles, measured in Chromium, Firefox and WebKit at 430, 390 and 320 on
  thirteen detail pages (a film, place, book, organization, painting and
  perfume each with a 64 to 79-letter title, a 51-letter series, and short
  titles of each kind), against main before #293:
  - words split across lines: 9 before, 0 now ("Shakespeare",
    "Decorative", "Encouragement", "Manufactures" at 320);
  - an 80-letter title: 3 lines at 390 and 4 at 320 (5 and 7 before); the
    66-letter museum 3 lines at both (7 and 9 before); the 51-letter series
    at 38px, 3 and 4 lines;
  - short titles keep 46px.
- Series rows, three engines at 1440, 600, 390 and 320: the badges and the
  first control's icon are 0px from the title's edge (8px and 14px before).
- Alignment, design, overflow and touch audits clean on the eleven pages in
  three browsers at six widths (198 of 198). Page weight passes. The phone
  audit's remaining new findings are the recommenders' first card (fixed by
  #297) and the book page's plain series link, which shows only with the
  preview's series fixture.
- `detail-title-row.test.ts` pins the marks and their CSS.
- No migration, no new package.
- Review fix: on a phone, a readable book's controls row was pulled out by a
  ghost icon button's padding (14px on touch), so Read, whose padding is 8px,
  started 6px past the title's edge. The row is now pulled out by its first
  control's own padding: Read's 8px, or the icon button's 10px (14px on
  touch). Every row's first icon is on the title's edge (0px) in Chromium,
  Firefox and WebKit at 600, 390 and 320.

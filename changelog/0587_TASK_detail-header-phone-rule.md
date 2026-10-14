# Task 0587: Detail header on a phone, the shared rule, on the book page

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0537
**Blocks**: None

## Overview

SLN-641 design contract, section 12, piece 1 (SLN-639 part 2). The
publisher page's phone header rule from #260 (0537) moves into the shared
detail layout, and the book page takes it. On a phone a long title takes the
row's width and its controls go under it, the star lined up with the title's
edge. The other detail kinds follow in piece 2.

## Implementation Details

- **`DetailTitleRow`** (`src/components/shared/detail-layout.tsx`): the h1
  and its controls in `CapAlignedControls`, with #260's classes. The row is a
  container; in a narrow row the controls wrap under a title that would not
  fit on one line beside them, and from a set width they stay beside it.
  The title grows to fill its line, so wrapped it takes the row's width; the
  star's padding is pulled out (`-ml-2`, `-ml-3.5` on touch) so its icon
  lines up with the title. CSS alone decides, so nothing moves after the
  first paint.
- **Where the row stops wrapping depends on the controls.** Wrapping can
  make a header taller: a title too long for one line across the row takes
  a line for the controls under it as well. Below about twice the controls'
  width with their gap, a title that wraps beside them takes at least one
  more line than across the row, so wrapping there is never taller.
  - The publisher's star, Edit and menu (157px on touch): 24rem, as in #260.
  - The book's favourite, collection, copy, Export and menu (249px, 297px on
    touch; `wideControls`): 33rem, 39rem on touch. At 24rem the book's
    title was squeezed to a fifth of a 430px phone's row, and "Nadja" took
    two lines.
  - The book keeps its 12px gap between title and controls (the publisher's
    is 16px): with 16px, "Nadja" beside a poster on a 640px tablet no longer
    fit and the header grew a line.
- **Publisher header**: uses `DetailTitleRow`; nothing it renders changes.
- **Book page** (`library/[slug]/page.tsx`): uses `DetailTitleRow
  wideControls`. Before, its controls wrapped under a long title only below
  640px of window, kept the title at its own width, and sat 12px under it.

## Completion Notes

- Measured the title row and the header with the contract's fixtures (a
  90-letter title, a 32-letter word, "Ada or Ardor: A Family Chronicle",
  "Nadja") in Chromium, Firefox and WebKit at 1440, 1024, 768, 640, 430, 390
  and 320, touch below 800, against main on the same database. The book
  page was measured without a poster and with a poster's 176 x 256px box
  beside the header (the seed has no posters).
  - No header and no title row is taller than on main anywhere (168 book
    measures, 84 publisher). 94 book headers are shorter: beside a poster at
    768 the 90-letter title's row went from 728 to 260px in Chromium, and on
    a phone every wrapped header loses the 12px under the title.
  - The publisher page measures the same as main in all 84.
  - At 430, 390 and 320 a wrapped title takes the full row; the star's icon
    is 0px from the title's left edge in all three browsers.
  - The title's box is the same at load and 2s later in every run; no page
    scrolls sideways.
- `phone-audit.mjs --strict`: 0 new findings, no squeezed title.
- Alignment, design, overflow and touch audits clean on the book page and the
  publisher page, with their own titles and the 90-letter one, in all three
  browsers at 1440, 1024, 768, 430, 390 and 320 (72 of 72).
- `page-weight.js` passes (book page 115 of 400 KB).
- New `detail-title-row` test pins the classes and both pages' use.
- No migration and no new packages.

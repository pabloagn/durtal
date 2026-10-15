# Task 0597: Series rows at 320, and detail titles stepping down by length

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0594
**Blocks**: None

## Overview

Two follow-ups to 0594.

- The series page scrolled sideways at 320 when a book could be read: Read and
  the three buttons (earlier, later, remove) did not fit the row's column on
  touch, as on main.
- A detail title's single step at 40 letters let a 38-letter title wrap to
  four lines at 320 while a 61-letter one took three. Titles now step at 32
  and 56 letters, with sizes chosen so a longer title does not take fewer lines.

## Implementation Details

- `series-books.tsx`:
  - The phone controls row is a container. Where it is narrower than 13rem
    (a readable book at about 360px and under), the three buttons take a line
    of their own under Read. They are pulled out by their own padding, so
    their first icon is on the title's edge, as Read's is.
  - The controls are centred in their row. Read is 32px tall and the buttons
    28px, so the buttons' icons sat 2px above Read's and the title's cap
    centre (the alignment audit flagged it at 1440 and 1024 in WebKit).
- `DetailTitleRow` marks a plain-text title `short` (up to 32 letters), `long`
  (past 32) or `longer` (past 56). Under 640px `long` is 38px and `longer` is
  30px. Under 375px `short` is 38px and both longer bands are 30px: at 46px
  there, a 30-letter title could take three lines while a 33-letter one at
  38px took two.
- `layout-audit.js` allows four lines for `long` and `longer` titles only.
- Docs: the `type-page-title` row in `docs/03_DESIGN_LANGUAGE.md`.

## Completion Notes

- Title lines measured on a book page with 316 generated titles of 12 to 90
  letters, in Chromium, Firefox and WebKit. The figures are mean lines either
  side of each step.

  | Width | Sizes | Up to 32 | 33 to 56 | Past 56 | 32/33 step | 56/57 step | 80 letters |
  |---|---|---|---|---|---|---|---|
  | 390 | 46/38/30 | 1-3 | 2-3 | 2-4 | 2.13 → 2.06 | 3.00 → 2.50 | 3-4 |
  | 375 | 46/38/30 | 1-3 | 2-3 | 2-4 | 2.13 → 2.06 | 3.00 → 2.85 | 3-4 |
  | 360 | 38/30/30 | 1-2 | 2-3 | 2-4 | 2.00 → 2.00 | 2.64 → 2.95 | 3-4 |
  | 320 | 38/30/30 | 1-3 | 2-3 | 3-5 | 2.13 → 2.00 | 2.86 → 3.05 | 4 |

  With one size per band a step can still save a fraction of a line, as at
  390 past 56 letters. A 38-letter title no longer takes more lines than a
  61-letter one at any width; at 320 the 33-to-56 band tops out at three
  lines and past 56 starts at three.
- Series page, readable book: no sideways scroll at 320 in Chromium, Firefox
  and WebKit (39px in WebKit and 15px in Firefox before). Read, earlier,
  later and remove fit on one line at 390. At 360 and 320 the buttons sit on
  a second line, and every first icon is on the title's edge (0px).
- Alignment, design, overflow and touch audits are clean on the series page
  and two book pages, in three browsers at 1440, 1024, 768, 430, 390 and 320
  (54 of 54).
- `detail-title-row.test.ts` pins the three marks and both media rules.
- No migration, no new package.

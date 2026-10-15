# Task 0597: Series rows at 320, detail and collection titles stepping down by length

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0594
**Blocks**: None

## Overview

Follow-ups to 0594 and 0593, two of them from the main audit of 15 October
(`/mnt/project-files/findings/audit-2026-10-15.md`, finding 2).

- The series page scrolled sideways at 320 when a book could be read: Read and
  the three buttons (earlier, later, remove) did not fit the row's column on
  touch, as on main.
- A detail title's single step at 40 letters let a 38-letter title wrap to
  four lines at 320 while a 61-letter one took three. Titles now step at 30
  and 60 letters, where a longer title seldom takes fewer lines than a
  shorter one.
- A collection's name, in a header of its own rather than `DetailTitleRow`,
  never stepped down: a 68-letter name took 4 lines at 390 and 5 at 320. On a
  phone it could also break inside a word beside its floating icon.
- On a book's eBook line (0593), Read became a flex item, so it no longer
  counted as a link inside text, and its press area was 34px wide on touch.

## Implementation Details

- `series-books.tsx`:
  - The phone controls row is a container. Where it is narrower than 13rem
    (a readable book at about 360px and under), the three buttons take a line
    of their own under Read. They are pulled out by their own padding, so
    their first icon is on the title's edge, as Read's is.
  - The controls are centred in their row. Read is 32px tall and the buttons
    28px, so the buttons' icons sat 2px above Read's and the title's cap
    centre (the alignment audit flagged it at 1440 and 1024 in WebKit).
- `DetailTitleRow` marks a plain-text title `short` (up to 30 letters), `long`
  (past 30) or `longer` (past 60). Under 640px `long` is 38px and `longer` is
  30px. Under 375px `short` is 38px and both longer bands are 30px: at 46px
  there, a 30-letter title could take three lines while a 33-letter one at
  38px took two.
- `titleLength(title)` in `detail-layout.tsx` gives the mark, and the rules in
  `globals.css` match `[data-title-length]` on any element. The collection
  page marks its name and the row its icon and star sit on, so they stay on
  the name's first line at each size. Its `max-md:[overflow-wrap:anywhere]` is
  gone: only a word too long for the line breaks inside itself.
- `instance-detail.tsx`: Read on the eBook line takes `touch-hit`, a 44px
  press area on touch. "eBook details" and Unlink were already wide enough.
- `layout-audit.js` allows four lines for `long` and `longer` titles only.
- Docs: the `type-page-title` row in `docs/03_DESIGN_LANGUAGE.md`.

## Completion Notes

- Where the steps sit (review): 474 generated titles of 12 to 90 letters on
  a book page, in Chromium, Firefox and WebKit at 11 widths from 320 to 639.
  For pairs of titles 1 to 5 letters either side of a step, the share where
  the longer one takes fewer lines:

  | Width | 32/33 | 56/57 | 30/31 (now) | 60/61 (now) |
  |---|---|---|---|---|
  | 430 | 0% | 90-93% | 0% | 63-73% |
  | 414 | 0% | 67-74% | 0% | 33-50% |
  | 390 | 3-7% | 40-47% | 0% | 7-10% |
  | 375 | 0-20% | 8-27% | 3% | 0-16% |
  | 320 | 13-20% | (same size) | 3% | (same size) |

  No single step point makes lines rise at every width, since each size fits
  a different number of letters per line; 30 and 60 are better than 32 and
  56 at every common phone width from 320 to 430. A 38-letter title no longer
  takes more lines than a 61-letter one, and an 80-letter title takes 3 or 4
  lines at 390.
- Series page, readable book: no sideways scroll at 320 in Chromium, Firefox
  and WebKit (39px in WebKit and 15px in Firefox before). Read, earlier,
  later and remove fit on one line at 390. At 360 and 320 the buttons sit on
  a second line, and every first icon is on the title's edge (0px).
- Alignment, design, overflow and touch audits are clean on the series page
  and two book pages, in three browsers at 1440, 1024, 768, 430, 390 and 320
  (54 of 54).
- `detail-title-row.test.ts` pins the three marks and both media rules.
- No migration, no new package.

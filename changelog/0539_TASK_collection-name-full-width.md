# Task 0539: A long collection name takes the row's full width on a phone

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

From the design audit (SLN-641 slice 2, P1 "A long collection name is
squeezed by the controls beside it"). On a phone, a collection's icon
(left) and favourite star (right) each kept a 44px column beside the whole
name, so "Books bought from the bouquinistes along the Seine…" took 11
lines at 320px and 8 at 390px.

## Implementation Details

`src/app/(catalogue)/collections/[id]/page.tsx`, below 768px (`max-md:`):
the title row is a block, the icon floats left and the star floats right
of the name's first line, so every later line takes the row's full width.
Both stay on the first line's cap-height center. The star comes before the
name in the source so it can float at the top; from 768px the row is the
same flex row as before, with the star ordered last (`order-last`). Its icon
sits on the row's right edge (`-mr-2`, `-mr-3.5` on touch, its padding),
as `icon-hit-end` does on cards. The name breaks inside a word
(`overflow-wrap: anywhere`) rather than leaving the first line empty.

A CSS wrap width like #260's was tried first and dropped: with the icon on
the left and the cover beside the header from 600px up, every width that
shortened a long name made common names 52px taller (273 renders, see the
slice 2 report). The cover was already above the title on phones.

## Completion Notes

Measured on main and on this branch with 10 names on a disposable preview:
- 3 long ones: "Books bought from the bouquinistes along the Seine…", "Les
  Rougon-Macquart: histoire naturelle et sociale…" and "Bibliothèque idéale
  des Éditions de la Pléiade, première série".
- 6 ordinary ones, "Oulipo" to "Nineteenth-Century Russian Novels".
- 1 single 32-letter word.

The browsers were Chromium at 16 widths from 1440 to 320, and Firefox and
WebKit at 1440, 768, 767, 430, 390, 360 and 320, with touch below 800. That
is 300 renders.

| Name, Chromium | 390 before | 390 after | 320 before | 320 after |
|---|---|---|---|---|
| Books bought from the bouquinistes… | 8 lines | 6 | 11 | 7 |
| Les Rougon-Macquart: histoire naturelle… | 7 | 5 | 11 | 6 |
| Penguin Modern Classics | 3 | 2 | 3 | 2 |
| Decadents and Symbolists | 2 | 2 | 3 | 2 |

- Header heights: 101 shorter (8,216px in all), 197 the same, and 2 taller.
  Both taller ones are "Verlagsbuchhandlungsgesellschaft" in Firefox at 430
  and 767, which takes 3 lines instead of 2 (52px).
- Chromium and Firefox at 768 and above: icon, name and star are where they
  were on main. Headless WebKit applies the phone layout at 768 too: it
  takes the page as 762px wide.
- On a phone the star's icon is 0px from the row's right edge, and the
  star and the icon are on the same center, in all 210 renders below 768.
- A short name that fits on one line keeps the star at the row's right
  edge rather than right after the name.
- The alignment, design, overflow and touch audits are clean at 1440, 768,
  390 and 320 in all three browsers. No page scrolls sideways.
- Keyboard order is unchanged (icon, then star). A screen reader now reads
  the star's button just before the name.
- /collections page weight: 89 KB, 38 ms.

Review fix: the title row starts 8px early for the icon button's padding, so
on a phone the name's later lines, running under the icon, started 8px left
of the cover and description. The name takes `max-md:pl-2`: the first line
still starts after the icon, and later lines start on the page's text edge.
Pinned by `collection-title-edge`.

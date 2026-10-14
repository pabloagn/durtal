# Task 0537: A long publisher name keeps the row's width on a phone

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

From the design audit (SLN-641 slice 1, P1 "A long title is squeezed into
a narrow column by the actions beside it"). On a publisher page the
favourite, Edit and actions menu (157px on touch) share the name's row, so
at 390px "Penguin Modern Classics" took 3 lines in a 185px column, and 6
at 320px. The facts and the books fell below the first screen.

## Implementation Details

`src/components/publishers/publisher-header.tsx`: the name's row can
wrap below a 36rem container (`@container`, `@xl:flex-nowrap`), and the
controls go under the name, starting at its left edge in the name's
cap-aligned slot. CSS alone wraps whenever the name would not fit on one
line beside the controls, which also drops them under a name that takes
as many lines at full width, so a header grows. `useControlsPlacement`
measures once after layout, on a width change and when the fonts arrive. It
puts the controls under the name only when that makes the header shorter
or keeps a word whole, and beside it otherwise (`data-layout`). Until it has
measured, the CSS rule stands.

Only the publisher header changes. The other detail headers have the same
pattern; the book page's actions on a phone are an open question to Joris,
so they are left as they are.

## Completion Notes

Measured on main and on this branch in headless Chromium, Firefox and
WebKit at 1440, 1024, 768, 430, 390 and 320px (touch below 800 in Chromium
and WebKit), with Gallimard and three long names on a disposable preview
database: "Penguin Modern Classics", "Éditions de la Bibliothèque des
Introuvables et Curiosités Littéraires" and "Verlagsbuchhandlungsgesellschaft".

| Name, Chromium | 390 before | 390 after | 320 before | 320 after |
|---|---|---|---|---|
| Gallimard | 1 line | 1 line | 2 lines, 115px | 1 line, 288px |
| Penguin Modern Classics | 3 lines, 185px | 3 lines, as before (2 under would not be shorter) | 6 lines | 2 lines |
| Éditions de la Bibliothèque… | 8 lines | 4 lines | 13 lines | 5 lines |

- At 320 and 390 the books section starts up to 364px higher. At 1440
  nothing moves.
- Alignment, design, overflow and touch audits: no issue in any of the 72
  renders, as on main. WebKit lists the "Organization page" link under
  text links on main and here alike.
- /publishers page weight: 78 KB, 39 ms.

Review fix: under the name the favourite star's padding indented it 14px
(8px with a mouse) from the name's left edge. Below 36rem the controls now
take `-ml-2 pointer-coarse:-ml-3.5` (the star's `icon-hit` padding) and the
row's gap grows by the same amount (`gap-x-6 pointer-coarse:gap-x-7.5`), so
the star lines up with the name when the controls wrap, and beside a name
the gap is unchanged. The same holds from 36rem, so the rule is not
repeated there.

The review also found that at 430 to 768 ordinary names that take as many
lines at full width (Fondo de Cultura Económica at 768 and 500, Bibliothèque
de la Pléiade at 430) got the controls' row and a header 32 to 52px taller.
That is what the measured placement above fixes.

Measured against main on a disposable preview with Gallimard, the three long
names, and 8 real ones:
- Fondo de Cultura Económica
- Bibliothèque de la Pléiade
- Farrar, Straus and Giroux
- New York Review Books
- Penguin Classics
- Editorial Anagrama
- Éditions de Minuit
- Suhrkamp Verlag

The browsers and widths were Chromium at 1440, 1024, 900, 768, 640, 600, 500,
430, 390, 375 and 320, and Firefox and WebKit at 1440, 1024, 768, 430, 390
and 320, with touch below 800 in Chromium and WebKit. That is 276 renders.

- No header is taller than on main. 226 are the same height and 50 are
  shorter, by 52 to 364px. For example, "Éditions de la Bibliothèque…" at
  430 goes from 7 lines to 4 plus the controls (104px shorter). At 320,
  "Bibliothèque de la Pléiade" goes from 5 lines to 2 (104px shorter).
- The reviewer's cases now look as on main: Fondo de Cultura Económica at
  768 and 500, and Bibliothèque de la Pléiade at 430, keep 2 lines with the
  controls beside them.
- Under the name, the star starts at the name's left edge (0px off) in every
  render.
- The alignment, design, overflow and touch audits are clean in the 144
  renders at 1440, 768, 390 and 320.
- Where the measured placement differs from the CSS rule (a name that
  wraps on one line beside the controls and as many at full width), the
  controls move once, when the page's script has loaded.

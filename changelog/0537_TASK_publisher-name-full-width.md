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

`src/components/publishers/publisher-header.tsx`: the name's row wraps
below a 36rem container (`@container`, `@xl:flex-nowrap`). The name takes
its natural width (`flex: 1 1 auto`), so the controls stay beside a name
that fits on one line next to them and go to their own row under a longer
one, starting at the name's left edge, still the name's cap-aligned slot.
From 36rem the row is as before.

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
| Penguin Modern Classics | 3 lines, 185px | 2 lines, 358px | 6 lines | 2 lines |
| Éditions de la Bibliothèque… | 8 lines | 4 lines | 13 lines | 5 lines |

- At 320 and 390 the books section starts up to 364px higher, never
  lower: at 390 "Penguin Modern Classics" saves a title line and spends it
  on the controls' row, so its books stay where they were. At 1440 nothing
  moves. At 1024 and 768 a long name gains its width and the page
  is as tall or shorter, except one 32-letter word, which still breaks in
  two and puts the controls one line lower (32px).
- Alignment, design, overflow and touch audits: no issue in any of the 72
  renders, as on main. WebKit lists the "Organization page" link under
  text links on main and here alike.
- /publishers page weight: 78 KB, 39 ms.

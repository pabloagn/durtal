# Task 0563: Page turn buttons stay up in their margin, and checks for every press

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0501
**Blocks**: None

## Overview

SLN-662 leftovers from 0501. A click in the text no longer turns the page,
so a mouse turns with the keys, the wheel or the two page buttons at the edges.
Those buttons showed and hid with the bars: with the mouse resting in a margin
they faded after 3 s, though the ticket asks for them to show on hovering the
margin. The ticket's long press, drag selection, link tap and tap-to-close
cases also had no browser check.

## Implementation Details

- `src/components/reader/reader-shell.tsx`: `useReaderBars` keeps the margin
  the mouse is in (`edge`: the outer 12% of the width on either side, as the
  touch edge strips). Leaving the window clears it. The bars still show on any
  real mouse movement and hide 3 s after it rests, so there is still no hot
  strip that brings them back (SLN-663).
- `src/components/reader/page-edges.tsx`: each button shows with the bars or
  while the mouse is in its margin (`hovered`), and is inert when hidden.
- `scripts/qa/reader-engine-check.mjs`: a new `pointer` check.
  - At 1440: a double-click selects a word and keeps the place. With a
    selection, a click in the text clears it and the toolbar and keeps the
    place. A drag selects, shows the toolbar and keeps the place. With a
    selection, a click in the margin clears it. Once the bars hide, only the
    button of the margin the mouse rests in stays up. A click on a link to the
    notes follows it.
  - At 390 with touch (Chromium, WebKit): a long press keeps the place; with
    a selection, a tap in an edge strip clears it and does not turn; a tap on
    a link follows it.
  - The link rows turn to the notes link from page 24 of fixture 20: after a
    jump the Back to chip stays over the bottom lines for three turns, and
    Chromium sets the link there on a phone. Fixture 19 is left to the
    navigation check.
  - The ticket names `reader-navigation-checks.mjs`; the pointer cases need
    Playwright's mouse and touchscreen, so they sit with the touch and bars
    checks in `reader-engine-check.mjs`.

## Completion Notes

- Tests: `reader-bars.test.ts` (the margin is tracked after the bars hide, and
  cleared in the middle and when the mouse leaves) and a new
  `page-edges.test.ts` (both buttons with the bars, only the hovered one
  without, in the book's direction).
- `reader-engine-check.mjs` on a fresh preview: every touch, bars and pointer
  row passes in Chromium, WebKit and Firefox. The other rows fail as on main
  in this environment (font and dialogs time out waiting for a control;
  Firefox direction and saved place; the navigation notes row,
  which also fails on main from its second run).
- Not covered: a long press in headless browsers cannot make a native
  selection, so the check proves the press keeps the place; the selection a
  long press makes on a phone is made from script for the tap-to-close row.
- No migration and no new packages.

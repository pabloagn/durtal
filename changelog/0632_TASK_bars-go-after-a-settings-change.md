# Task 0632: The bars go again after a settings change

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Found while checking the reader against its reading rules. Open Reading
settings with the mouse, change anything (the scope, the page colour, the
flow) and close it: the top and bottom bars stayed up for good, through
idle, page turns and, in a scrolled book, scrolling, until a click in the
text. With nothing changed they hid as usual. All three engines.

## Implementation Details

- Cause: closing a panel returns focus to the bar button that opened it, and
  focus in the bars keeps them up. The bars hook kept one flag for "the
  pointer is over the bars" and "focus is in them", and only a pointer
  leaving the bars or a blur cleared it. After a change in the panel the
  pointer was last over the panel, not the bars, so nothing cleared it; a
  turn could not hide the bars either.
- `src/components/reader/reader-shell.tsx` (`useReaderBars`): the pointer
  and focus are held apart. `release()` lets go of focus left in the bars;
  real mouse movement lets go of it too, since a moving mouse is a reader's
  hand, not a keyboard user's focus. The pointer over the bars and a held
  panel keep them up as before.
- `src/app/reader/[ebookId]/reader-view.tsx`: a turn and a scroll release
  the bars, so they go as after any turn (a turn at once, a scroll after the
  usual wait). When they go, focus leaves them with them; Tab brings both
  back, onto the control after the one that had focus.
- A keyboard user who tabs into the bars and waits keeps them up, as before.

## Completion Notes

- Chromium, WebKit and Firefox at 1440, Book 5: Settings opened with the
  mouse, with no change and with "This book", Sepia or Scroll chosen, then
  Escape. Before, with a change, the bars stayed up after 4.5 s idle and
  after two turns. Now they hide after the usual wait and on a turn. In a
  scrolled book they hide after a wheel scroll; on main they stayed up.
- Keyboard only, at 1440 in all three engines and at 390 in Chromium and
  WebKit: Tab to Settings (More at 390), open it, choose Sepia and press
  Escape. The bars stay up while focus sits on the button, go on a turn, and
  Tab brings them back.
- Seen on main as well, not changed here: in Firefox, Tab from inside the
  book never reaches the bars.
- `reader-engine-check.mjs`: 278 of 278 rows pass. 0 alignment and
  design-audit findings on the reader (EPUB and PDF) in all three engines at
  1440, 390 and 320; `page-weight.js` within budget.
- Test: `reader-view.test.ts` puts focus on a top-bar button, then checks that
  the bars go after a scroll, a turn and a mouse move. It fails without the
  fix.
- No migration and no new packages.

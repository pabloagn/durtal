# Task 0517: One queued page turn, Esc and the menu key show the bars, a progress line

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0501
**Blocks**: None

## Overview

What 0501 left of SLN-673 and SLN-663. Rapid arrow presses still turned up
to three more pages after the last one, as two turns could wait behind the
one on screen, and a turn that ran out of pages could skip a section when a
background fill finished meanwhile. The bars came back on a mouse move, a tap
or Tab, but not on Esc or the menu key, and once hidden nothing showed how
far through the book you were outside the paginated running lines.

## Implementation Details

- `MAX_QUEUED_TURNS` is 1 (`src/lib/reader/navigation.ts`): one turn waits
  behind the one on screen and further presses drop, so letting go stops
  within a turn. Key repeats still drop while a turn runs (`input.ts`).
- `paginator.js` (VENDORED.md 22): `#turnPage` reads the edge section before
  awaiting a background fill, so a fill that appends the next section can no
  longer make the turn go to the one after it.
- Esc with nothing left to close (after leaving full screen, if it was)
  shows the bars; the menu key (`ContextMenu`) shows them through a new
  `showBars` action. Neither does anything while a dialog is open.
- `ReaderBottomBar` draws a 2px line along the bottom edge while the bars are
  hidden, as wide as the percent read, in `fg-muted`, above the safe area. It
  fades out when the bars come up (150 ms, none with reduced motion) and is
  hidden from assistive technology, which reads the place in the bar.

## Completion Notes

- Measured with 30 presses 33 ms apart and a held key, on the reader
  fixtures with several sections, in headless Chromium, Firefox and WebKit:
  no section skipped in any run; after the last press at most two pages
  finish (the one turning and the one waiting, about 0.5 s), down from three
  (about 0.9 s). A held key's repeats give at most one.
- Esc and the menu key bring the bars up and they hide again after 3 s, and
  the line shows the same percent as the bar, in all three browsers at 1440,
  390 and 320. Alignment, design and overflow audits are clean with the bars
  up and hidden. `page-weight.js` passes (/reader at 22 KB).
- Not covered (the tickets stay open): reserving space so the bars never
  cover the last line, and a chapter label beside the line in scrolled mode
  and PDFs (paginated books keep their running lines). The skip did not
  reproduce before the fix in these runs, so the paginator change rests on
  reading the code.
- Tests: `navigation.test.ts` (one waiting turn, a third press drops),
  `input.test.ts` (the menu key), new `reader-progress-line.test.ts`.
- No migration and no new packages.

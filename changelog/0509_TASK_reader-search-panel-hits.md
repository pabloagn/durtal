# Task 0509: Reader search keeps its hits in view

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-675, from the e-book review of 13 Oct. On a wide screen the search
panel stayed open over the page and covered the hit it had jumped to.
Closing it with its X ended the search, so the highlights and the results
bar went with it. After a pick, Escape did nothing. The results bar had no
tooltips and square glass corners. The field's clear control was the bright
browser default, and the empty state said only "No matches".

## Implementation Details

- The panel moves off the hit (`src/components/reader/search-panel.tsx`):
  - after a jump on a wide screen (1024 px and up, where the panel is not
    modal), it asks the reader where the hit's first line is
    (`hitRect`, from the new engine method `locatorRect`);
  - when the panel would cover the hit, it moves to the other side;
  - `ReaderSidePanel` takes `side` ("left" or "right") for its drawer, with
    the border on the inner edge.
- `locatorRect` (`src/lib/reader/engines/foliate/engine.ts`) resolves an
  EPUB place's range, or a PDF place's first rect, and measures its first
  line in host viewport coordinates. `frameRectToHost` is split out of
  `selectionHostRect` (`selection.ts`) for it.
- Closing:
  - the panel's X and Escape close only the panel, so the hits stay marked
    and the results bar ("3 of 1,397", Previous, Next, Results, Close search)
    appears;
  - the reader's Escape (`reader-view.tsx`) closes the panel first, then
    ends the search through `escapeRef`, from the book or the page.
- The results bar:
  - is the `glass` floating surface, sized to its content and centred;
  - below 1024 px it sits above the Back chip, which shares its row;
  - its icon buttons have tooltips, and Close search names Esc.
- The field hides the browser's clear control and has its own (`Clear search`).
- The empty state names the query and the options that narrow it: "No
  matches for “zzqx”. Whole words is on; turning it off may find more."

## Completion Notes

- Checked headless on the 2,000-page fixture, in Chromium, Firefox and
  WebKit:
  - At 1280 and 1100 px, a hit under the left drawer moves it to the right,
    and a later hit under the right drawer moves it back. Hits clear of the
    drawer leave it where it is. The hit's position was measured in the frame
    each time.
  - At 1280 px: Esc closes the panel with the hits kept and the bar shown,
    and a second Esc ends the search with the marks cleared. The X, Next and
    Close search behave the same way.
  - At 390 px, Enter still closes the sheet and jumps, and Esc ends the
    search.
- The alignment, design and overflow audits are clean with the panel open
  and with the bar shown, at 1440, 1024, 390 and 320 px in all three
  browsers.
- Search speed is unchanged: the search itself is untouched, and the move
  measures one range after each jump.

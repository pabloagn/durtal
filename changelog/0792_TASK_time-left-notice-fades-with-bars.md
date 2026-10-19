# Task 0792: The reader's time left fades with the bars

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1143. The reader's "About … left" notice floats just under the top bar.
When the bars hid, as they do by default for full-screen reading, it stayed
on screen, over the first lines of the right-hand page in a spread at 1440,
and over the chapter heading at 390 and 320.

## Implementation Details

- `src/components/reader/reader-notice.tsx`: `ReaderNotice` takes `quiet`
  (the bars are hidden). A notice that holds only a plug-in's line, the time
  left, then fades with the bars (`opacity-0`, no pointer events, the bars'
  150 ms fade) and stays in place as a live region, so it is announced as
  before. An offer, an error or a paused sync stays up, as SLN-729 left them.
- `src/app/reader/[ebookId]/reader-view.tsx`: passes `quiet={!bars.visible}`;
  "Keep the toolbars visible" keeps the bars, so the notice stays.

## Completion Notes

- `reader/reader-notice.test.ts`: the time left fades with the bars and
  stays a live region with its text; an offer keeps the notice up.
- Production build on the preview database (`--seed-reader`), E01 with
  tracking and a page count, Chromium, Firefox and WebKit at 1440, 390 and
  320: with the bars shown the notice is at full opacity; after they hide it
  is at 0, still `aria-live="polite"` with its text; with "Keep the toolbars
  visible" it stays up. 0 alignment findings with the bars shown.
- With the bars shown the notice still sits over the first one or two lines
  at the top (as before); the ticket asks only for the hidden bars.
- Page weight within budget on every route. No migration and no new packages.

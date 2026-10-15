# Task 0628: "Your place from" sits in the bottom bar, clear of the text

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Finding 7 of the reader audit (SLN-729). A book opened at a place another
device saved says so for four seconds. The line floated in the glass notice
under the top bar, over the first lines of the text (2 to 6 lines of the
EPUB and the text PDF at 1440 and 390), and it took two lines at 320.

## Implementation Details

- `src/components/reader/reader-bottom-bar.tsx`: a `placeFrom` prop names the
  device in the bar's left cell, where the chapter sits, for as long as the
  line shows. The text never runs under the bar, so the line covers nothing.
  Under 480px it reads "From iPhone · Safari"; wider, "Your place from
  iPhone · Safari"; exactly one wording applies at every width. While it
  shows, the tracking control and the time left give it their room, and
  under 480px the percent too, so the place stays and the line is never cut,
  even beside "pp. 87–88 of 320" (review of #351). A live region outside the bar (which is inert while hidden) announces
  "Your place from ..." either way.
- `src/app/reader/[ebookId]/reader-view.tsx`: the open sets `placeFrom`
  instead of the floating notice, and a page turn clears it as it cleared the
  notice. The bars show on open as before, so the line shows with them; it
  does not hold them up, and a tap still hides them. The floating notice keeps the
  newer-place offer, sync and error lines.

## Completion Notes

- Headless Chromium, WebKit and Firefox at 1440, 390 and 320 (touch at 390
  and 320 in Chromium and WebKit), on the EPUB and the text PDF, with a place
  from "iPhone · Safari" and "Android · Firefox": the line is in the bar, one
  line, never cut, over no text, the bar showing; it is gone by 5.4 s.
  Before, on main's code, it covered 2 to 6 text lines at
  1440 and 1 or 2 on the EPUB at 390 and 320.
- `reader-engine-check.mjs`, run with places from other devices saved: 278
  rows, the bars and touch rows among them, pass (the two WebKit PDF "clear"
  rows failed once while a build ran beside the check, and passed on a rerun
  alone).
- 0 alignment deviations on the reader while it shows; `page-weight.js`
  within budget.
- Test: `reader-view.test.ts` checks the line is in the bottom bar and not
  in the floating notice, and that it goes after four seconds.
- No migration and no new packages.

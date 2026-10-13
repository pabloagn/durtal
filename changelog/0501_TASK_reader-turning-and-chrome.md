# Task 0501: Reader fixes, batch 2 (turning pages and the reader's bars)

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0500
**Blocks**: None

## Overview

The second batch from the 13 October e-book review (`/mnt/project-files/ebooks/review-2026-10-13.md`): how pages turn, and when the reader's bars show. It covers SLN-662, SLN-663, SLN-660, SLN-673 and SLN-674.

## Implementation Details

- **SLN-662, a click turned the page while selecting.** The old input layer turned on any click in the outer 30% of the page, gaps between lines included, and the click that dismissed a selection also turned.
  - A mouse click in the text never turns now. A mouse turns with the keys, the wheel, or the new page buttons (`page-edges.tsx`): a quiet chevron at each edge of the viewport, outside the text column. They show and hide with the bars, carry a tooltip with the arrow key, and follow the book's direction.
  - A tap turns only in a 12% strip at each edge (`TAP_ZONE` in `input.ts`); a tap anywhere else shows or hides the bars. A preference, "Tap the edges to turn pages", turns the strips off. It is on for phones and tablets and off for desktops, where it also lets a mouse click in the strip turn, never on a word.
  - A press that starts while a selection exists only dismisses it, for both click and touch.
- **SLN-663, the bars popped up on a 56 px hover band and vanished.** Any real pointer movement now shows the bars (`pointerAt` in `reader-shell.tsx` ignores the first sample and moves under 2 px), and they hide after the existing rest timer. A pointer over a bar or a page button holds them. A preference, "Keep the toolbars visible", pins them. They fade over 150 ms instead of sliding.
  - The bottom bar always shows the place (page or location, percent, time left in the chapter) beside the tracking control. Before, a linked book's tracking control replaced it.
- **SLN-660, the page turn read as a flash.**
  - The slide for a keyboard, tap or button turn is 250 ms instead of 60 ms (vendored paginator patch 20, `PAGE_SLIDE_MS`).
  - The View Transition background follows the reading theme: the book CSS sets `--theme-bg-color`, so the gutter band is no longer the browser's grey `Canvas`.
  - A jump's destination fades in over 150 ms instead of cutting from a blank page, with none under reduced motion. The page marker guard (`page-marker-visibility.ts`) judges a page that is fading in by where the fade ends, so Go to page still names the page it landed on.
- **SLN-673, a held arrow key kept turning for seconds.** The navigation queue keeps at most two turns waiting (`MAX_QUEUED_TURNS`), and a key repeat is dropped while a turn is still running.
- **SLN-674, scroll mode.** In scrolled flow the wheel is the browser's own scroll again (it no longer turns a whole screen), and the up and down arrow keys scroll 48 px (`scrollLines` on the foliate engine).
- The two preferences live in the presentation jsonb with defaults in `defaults.ts`, so no migration.

## Completion Notes

- Tests: the input layer (clicks in the text, edge strips, dismissing presses, touch, key repeats, scroll mode), a new `reader-bars.test.ts`, the turn queue bound, and the page marker guard during a fade.
- `scripts/qa/reader-engine-check.mjs`: the touch check now asserts that a middle tap toggles the bars and keeps the place and that only edge taps turn; the bars check asserts that a mouse move brings the bars back, clicks across the text keep the place, and the Next page button turns.
- Not covered yet:
  - a thin always-visible progress line while the bars are hidden;
  - reserving space so the bars never cover the last line;
  - Escape or the menu key showing the bars;
  - Space and Page Down overlap in scroll mode;
  - a jump transition with no blank at all, and the freeze before a slide starts.
- No migration and no new packages.

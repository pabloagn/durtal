# Task 0549: Cut titles show in full on keyboard focus

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-641 design contract, piece 9. The reading stats rankings show each title on one line, and a long one is cut. Hovering it already showed the full title: the app's tooltip shows any text cut by `truncate`, `lines-1` or `lines-2`, with no attribute. A keyboard reader could not see it, because keyboard focus never showed cut text.

The contract asked for a `data-tooltip` on each ranking title. The shared tooltip already finds cut text, so this extends that path to keyboard focus instead. It covers every cut title in the app, not just these four lists.

## Implementation Details

`src/components/ui/tooltip.tsx`:

- On keyboard focus, the tooltip looks for cut text in the focused link or button and in the boxes around it (up to three levels, as for hover).
  - Inside: the most-read and re-read rankings, where the link holds a `lines-1` span.
  - Around: the Fastest and Slowest facts, where the link sits in a `lines-1` value with its day count.
- The focused control anchors the tooltip, so the tooltip closes when focus leaves.
- `isCut` is shared by both lookups.

docs/03 (Tooltips) says it.

## Completion Notes

- **Test.** `src/__tests__/ui/cut-text-focus.test.ts` focuses a link holding a cut title and reads the tooltip. It also checks that a title that fits shows none. The first test fails with main's tooltip.
- **Browsers.** On a production build with long seeded titles, every cut title on `/reading/stats` shows its full text on hover and on Tab focus. That is 2 titles at 1440 and 3 at 390, in Chromium, Firefox and WebKit.
  - At these widths, `/reading/year/2026` cuts no title with the seeded reads.
- **Audits.** The shared browser runner passes 24 of 24 page loads on both pages at 1440, 768, 390 and 320. Page weight: `/reading/stats` is 109 of 400 KB.
- **From review.** On /reading/stats, the Fastest and Slowest titles sit in a one-line value. Focusing the link nudges that clipped box 2px, and the tooltip took that as a page scroll and closed. The tooltip now ignores scrolls of a cut text box. The new test in `cut-text-focus.test.ts` checks that a real scroll still closes it.

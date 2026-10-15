# Task 0629: The reader's bars keep whole words on phones

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Finding 8 of the reader audit (SLN-730). On phones the reader's bars cut
words in half ("Learning y…", "Track this bo…", "The Sudden Wi…"), and at
320 the top bar left the title one word: "The …" beside a PDF's Page
controls.

## Implementation Details

- `src/components/reader/fit-words.tsx` (new): one line of bar text that is
  never cut inside a word. Words drop from the end, with an ellipsis, until
  it fits; nothing shows when not even the first word fits. `whole` shows the
  text in full or not at all. It sizes as the full text would (a hidden
  `::before` carries it), so a flex row gives it the same room whatever it
  shows, and it fits again on a resize or when a web font arrives. Screen
  readers hear the full text.
- `src/components/reader/reader-toolbar.tsx`: the title and the chapter line
  use it. Under 360px Bookmark moves into More (as Settings does under 400),
  and beside Page controls, which list every page, Contents does too, so the
  title keeps two words.
- `src/components/reader/reader-bottom-bar.tsx`: the chapter and the quiet
  chapter band use it; the time left shows whole or gives way; the tracking
  control is no longer clipped ("Track this bo…") and keeps its whole label.

## Completion Notes

- Headless Chromium, WebKit and Firefox at 390 and 320 (touch in Chromium and
  WebKit) on the EPUB, the text PDF and the comic: no bar text is cut inside
  a word. Titles at 320: "The Distant…", "The Sudden…" and "The Six…" or
  more; before, "The …" for the PDF and the comic in Chromium and WebKit.
  At 1440 and 768 nothing is shortened.
- More at 320 holds Bookmark (and Contents for the PDF); at 390 the bar is as
  before.
- Alignment and design audits: 0 findings at 1440, 390 and 320 on the three
  books in all three engines; `page-weight.js` within budget.
- Test: `fit-words.test.ts` for the word fitting.
- No migration and no new packages.

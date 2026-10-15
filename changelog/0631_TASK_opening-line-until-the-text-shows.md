# Task 0631: A reopen keeps "Opening the book" until its text shows

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0575
**Blocks**: None

## Overview

Follow-up to SLN-696 (SLN-733). Since #309 the paginator keeps a reopened
book's text at opacity 0 until its spread is lined up, so the wrong page
never shows first. The reader turned ready before that, so "Opening the
book" went away and the page stood empty while it waited: about 0.2 to 0.3 s
in Chromium with the CPU slowed four times, about 50 to 80 ms unslowed in
WebKit and Firefox.

## Implementation Details

- `src/lib/reader/engines/foliate/engine.ts`: `textHidden()` says whether the
  paginator holds the text hidden now, and `whenTextShows(signal)` resolves
  once it shows (at once when nothing is hidden, as with a PDF or comic,
  whose renderer never hides its pages). Both read the paginator's container;
  no vendored code changes.
- `src/lib/reader/engine.ts`: both optional on `ReaderEngine`.
- `src/app/reader/[ebookId]/reader-view.tsx`: "Opening the book" stays from
  ready until the text shows, then fades out over the text's own 150 ms fade
  in, so the screen is never empty and nothing waits longer. While it stays
  past ready it lets clicks through. With reduced motion there is no fade:
  the line goes when the text shows, in the same render when it already
  does.

## Completion Notes

- Reopens of the EPUB 16 pages in, Chromium with the CPU slowed four times
  (three rounds) and WebKit and Firefox unslowed, at 1440 and 390: the line
  is up on every sample until the text's opacity passes 0.7 or more; no
  sample shows neither. Before, Chromium slowed showed neither for 0.2 to
  0.3 s, and WebKit and Firefox for 47 to 79 ms in three of four opens.
- Reduced motion in all three engines: the text appears at once and the line
  goes on the same sample.
- Test: `reader-view.test.ts` holds the text hidden past ready and checks the
  line stays, then goes once the text shows.
- No migration and no new packages.

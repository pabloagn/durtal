# Task 0656: The book page's byline wraps a long one-word name

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0652
**Blocks**: None

## Overview

Review of #347. With a 90-letter one-word author, the book page's byline ran
about 390px past a phone's screen in all three engines, and the page scrolled
sideways. Names are never cut, and pages never scroll sideways.

## Implementation Details

- `src/app/(catalogue)/library/[slug]/page.tsx`: each author in the byline is
  `min-w-0` with `overflow-wrap: anywhere`, so a word longer than the row
  breaks inside the row instead of pushing past it. Ordinary names still
  break only at spaces and hyphens.
- Test: `src/__tests__/ui/book-byline-wraps.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database in
  Chromium, Firefox and WebKit at 1440, 640, 390 and 320 (touch below 800,
  except Firefox), with the byline's name replaced by a 90-letter word.
  - On main the page was 740px wide at 390 and 320, and 940px at 640, in
    Chromium.
  - With the fix the name wraps onto 2 lines at 640 and 3 at 390 and 320. It
    ends on the row's edge. The page is never wider than the screen, and the
    overflow audit reports 0 everywhere.
  - Every "Joris-Karl Huysmans" on the book page and the person page was also
    replaced by the word: nothing else overflows.
- With the real name the byline's box is identical to main in all three
  engines at 1440, 390 and 320.
- Alignment audit clean. `page-weight.js` passes. Typecheck and lint clean.
  No migration, no new package.

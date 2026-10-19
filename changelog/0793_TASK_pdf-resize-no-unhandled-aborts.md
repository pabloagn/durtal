# Task 0793: Resizing a PDF no longer leaves unhandled aborts

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1169, from the review of the PDF reader. Resizing the window while a PDF
was open (1440 to 390 to 320 and back) logged unhandled promise rejections,
`AbortError`, in the console. The page itself was fine.

## Implementation Details

- A resize rebuilds the spread, and the pages it lets go of are released
  (`pdf-book.ts`, `release`), which aborts their zoom paint. The fixed layout
  (`src/vendor/foliate-js/fixed-layout.js`) dropped the promises of those
  paints, so their cancellation reached the window as an unhandled rejection.
- `zoomRetired(frame, error)`: an `AbortError` of a page no longer in the
  document is expected and ends quietly. Any other failure, or the
  cancellation of a page still shown, goes on as before. Used for the spread
  and for the scrolled pages.

## Completion Notes

- `reader/pdf-zoom-retired.test.ts`: the cancellation of a page let go of is
  expected; a real failure, or one of a page still shown, is not.
- Production build on the preview database (`--seed-reader`), E02 (PDF) with
  a mark, Chromium, Firefox and WebKit, resizing 1440, 390, 320 and back to
  1440: 0 unhandled rejections and 0 page errors (before, one or more per
  resize); the page keeps its canvas, its text layer (27 spans) and its mark,
  and the place stays at 25%.
- No interface change; no migration and no new packages.

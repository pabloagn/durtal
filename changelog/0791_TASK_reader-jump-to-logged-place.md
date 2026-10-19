# Task 0791: The reader offers a jump to the logged place ahead

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-931, from the Second reviewer's reading-tracking survey of 16 Oct (top
finding 4). After Log progress to p. 120 of 240, Reading, the dashboard and
the book page say 50%, while the e-book opens at its own place ("Tracking ·
3.5%") and nothing says the logged place is further on. The coordinator's
decision: the reader keeps its own place, and offers a small "Jump to p. 120"
while the logged place is more than a page ahead.

## Implementation Details

- `src/lib/reading/logged-place.ts`: `loggedPlaceAhead` (more than a page of
  the logged edition ahead, or 1% without its page count) and the label,
  "Jump to p. 120", or "Jump to 62%" for a place logged without a page.
- `src/lib/reader/bridge-state.ts`, `src/components/reader/bridge.tsx`: a
  plug-in can ask the reader to go to a share of the book (`useReaderJump`).
  The reader registers it (`src/app/reader/[ebookId]/reader-view.tsx`) as Go
  to page does, so it adds a history entry.
- `src/components/reading/reader-tracking.tsx`:
  - The jump sits in the bottom bar beside Tracking, so it never covers the
    text. Under 640px it shows an arrow and "p. 120", and takes the tracking control's
    room until it is used or dismissed, so the bar keeps its place and percent
    at 320.
  - It goes once the reader reaches or passes the logged place, after a jump,
    or when dismissed ("Stay at this place"); a later log offers it again.
  - "About ... left" explains itself with `data-tooltip`, not `title`.

## Completion Notes

- `reading/logged-place.test.ts`: the threshold (a page, or 1%), nothing
  without a logged or reader place, the labels and their phone form, and the
  bridge's jump (none registered, registered, unregistered).
- Production build on the preview database (`--seed-reader`), a fresh
  browser: Track this book, Log progress "120/240", open the book at its start.
  - No hint before logging. After it, "Jump to p. 120" shows; pressing it moves
    the reader to the logged place (the text from 50% on screen) and the hint
    goes. EPUB (E01) and PDF (E02), in Chromium, Firefox and WebKit.
  - Dismissing it hides it (WebKit, EPUB).
  - 0 alignment, contrast and naming findings, and no sideways overflow, at
    1440, 390 and 320 in all three engines, EPUB and PDF; at 320 the bar keeps
    its place and percent whole.
- Page weight within budget on every route. No migration and no new packages.

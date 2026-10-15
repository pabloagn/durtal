# Task 0574: Escape closes a reader panel wherever focus is

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0573
**Blocks**: None

## Overview

At 1024 px and wider, Contents, Reading settings, Search and Highlights
open beside the book and leave it usable, so focus can leave them: a click
into the book or a Tab into the bars. Escape then did nothing to the panel.
Escape cancels everywhere, so it now closes the latest such panel.

## Implementation Details

- `src/components/reader/side-panel.tsx`: a panel that is open and not
  modal registers its close; `closeLatestReaderPanel()` closes the latest
  one. A modal panel (under 1024 px) keeps the browser's own Escape.
- `src/app/reader/[ebookId]/reader-view.tsx`: the reader's Escape (from
  the book or the bars, when no dialog has taken it) closes that panel,
  after read aloud and the search panel, and before the bars come back.

## Completion Notes

- Browser check (scratch script), 1440 px, Chromium, WebKit and Firefox:
  Contents and Settings each close on one Escape with focus in the panel,
  on a toolbar button and in the book: 18 of 18 together with 0573's
  tooltip fix (6 of 18 with 0573 alone). Without 0573, a toolbar button that
  keyboard focus reached shows its tooltip, which takes that Escape.
- Test: `side-panel.test.ts` (closes a panel beside the book, never a
  modal one).
- No migration and no new packages.

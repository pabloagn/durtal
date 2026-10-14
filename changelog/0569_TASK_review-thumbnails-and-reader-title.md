# Task 0569: Review thumbnails at 4px; the reader's title takes its role

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Piece 11 of the SLN-641 design contract. A cover standing alone in a list
has 4px corners, and every titled block names its type role.

## Implementation Details

- `/ebooks/review`: the cover thumbnails in `review-row.tsx` and
  `differences-section.tsx` go from `rounded-xs` (2px) to `rounded-sm` (4px).
- `/reader/[ebookId]`: the book title's `h1` in `reader-toolbar.tsx` takes
  `type-item-title`. Its row keeps the role too, since `CapAligned` reads the
  row's font to sit the Back button on the title's cap height, so nothing
  moves.

## Completion Notes

- Measured in Chromium, Firefox and WebKit at 1440px: the review thumbnails
  are 60 x 88px with 4px corners; the reader title is Cirka 21px on a
  28.9px line, truncating with an ellipsis, as before.
- Alignment, design and overflow audits clean on `/ebooks/review` and the
  reader with its bars shown, at 1440, 390 and 320px in the three browsers.
- Page weight: `/ebooks/review` 92 of 300 KB, the reader 22 of 400 KB.
- Also: the review preview test that builds a 6,000 e-book library gets a
  30 s timeout. It takes about 2.3 s alone and ran past the 5 s default in a
  loaded full run.

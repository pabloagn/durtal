# Task 0745: Currently reading cards side by side keep their actions on one line

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0659
**Blocks**: None

## Overview

Review of #359. With two Currently reading cards in a row, a card whose
title wrapped onto more lines pushed its actions (Open eBook, Log progress,
the timer and the menu) lower than its neighbour's: 28.8px apart in the
review, with a title three lines long.

## Implementation Details

- `src/components/reading/hub-cards.tsx`: beside the cover, the actions
  sit at the card's foot (`@[280px]:self-end`, in the grid row that takes the
  card's spare height). Both cards stretch to the row, so their actions share
  one line. A card too narrow for the cover column keeps the actions under
  the cover and text, as before.
- Test: `src/__tests__/ui/reading-card-width.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database in
  Chromium, Firefox and WebKit at 1440, 1280, 1024, 640 and 390 (touch below
  800, except Firefox). The seed has one book being read, so a copy of its
  card was put beside it, and one card's title was made two lines longer.
  - Without the change (Chromium, 1440 and 1280): the actions were 14.5px
    apart.
  - With it, the actions' tops match to 0.0px at 1440 and 1280 in all three
    engines, 17px from each card's bottom edge (its padding and border).
  - With one card a row (1024 and below), nothing moves.
- Alignment, layout and overflow audits clean in every view. `page-weight.js`
  passes (/reading 102 of 300 KB). The build's TypeScript check and lint are
  clean. No migration, no new package.

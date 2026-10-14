# Task 0581: Up Next Start and a recommender's website icon line up with their text

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

From the design audit, SLN-641 slice 2, P2 "Alignment deviations".

## Implementation Details

- Reading hub, Up Next: each tile's ghost "Start" button sat under the
  book's title with its padding indenting the label 10px. The button
  (`QueueStartButton`, `src/components/reading/hub-actions.tsx`) now reaches
  past the column by its padding (`-ml-2.5`), so the label starts at the
  title's edge, as SLN-688 does for quiet buttons.
- Recommender card (`src/components/recommenders/recommender-card.tsx`): a
  website address that wraps kept its icon centered on both lines. The icon
  now sits on the first line's cap height (`CapAligned`), and the address
  stays centered in its 44px touch box.

## Completion Notes

Measured on a disposable preview against main in Chromium (1440, 1024, 390
and 320 with touch), Firefox (1440 and 390) and WebKit (1440, 390 and 320
with touch):
- Reading hub: the alignment audit found the 4 Up Next Start labels 10px
  in from their titles at every width in all three browsers; now 0.
- Recommenders: the website icon was 10 to 10.5px off its first line on
  touch at 390 in Chromium and WebKit; now 0.
- Overflow, design and touch audits: no issue. No other page changed.

# Task 0655: The Reading hub's cover rows are the house's work cards (SLN-769)

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0654
**Blocks**: None

## Overview
Design polish pass 1, finding 4 (`findings/design-polish-2026-10-15.md`). Up next and Recently finished on the Reading hub showed bare covers with a small sans title under them, at two widths on one page (five and six a row). Every other cover grid shows the framed work card with a Cirka `CardHeading`.

## Implementation Details
- `src/components/reading/reading-tiles.tsx`, `FinishedCovers`: each finished read is a work card (`WORK_CARD`, `WORK_CARD_BODY`): the cover, the title in `CardHeading`, then the stars and the finish date at the card's foot. The dashboard's Recently finished uses the same component, so it changes too.
- `src/app/(catalogue)/reading/(tabs)/page.tsx`: Up next's items are the same cards, with Start at the foot (its label on the text edge). Both rows sit in `catalogue-grid catalogue-density-compact` in a size container: 208px readable minimum, two a row on a phone (one on a 320px phone), titles wrap in full.
- Both rows, and the dashboard's Recently finished, end on a full row (`full-rows` and `fullRowAttributes` from SLN-774, #383): at four columns Up next shows four of its five.
- As on the library's cards, the cover is the card's one tab stop and a link with `tabIndex={-1}` covers the text, so the whole card is a touch target (a title link alone was 29px tall); Start sits above it.
- Test: `src/__tests__/ui/reading-hub-cover-cards.test.ts`.

## Completion Notes
Measured on the seed preview in Chromium, Firefox and WebKit at 1440, 1024, 390 and 320: both rows and the dashboard's row share one card width per viewport (208, 240, 175 and 288px in Chromium), cards in a row are of equal height, no title is clipped, and the alignment, layout, overflow and design audits are clean. `/reading` is 110 of 300 KB (102 before).

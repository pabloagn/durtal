# Task 0546: The rating's first star on the text edge

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: 0543 (SLN-695), 0544 (SLN-693 part 2)
**Blocks**: None

## Overview

SLN-641 design contract, piece 7. On the film, painting and perfume pages the "Your rating" row is part of the facts list, but its first star started 6px right of the values above it with a mouse and 16px right of the label on a touch screen, where the stars take a row of their own. The layout audit did not see it: its drifting-edge check looked only inside cards, and 16px is past its 12px window.

On a phone the rating row still spans the list under its label. The stars are 220px wide on touch (five 44px targets) and the value column is 212px at 390px, so they cannot sit beside the label.

## Implementation Details

- `RatingInput` (`src/components/shared/rating.tsx`) reaches past its column by half the space around a star in its target: 6px with a mouse and 16px on touch for 12px stars (`PULL`, one entry per star size). The first star starts on the text edge, and each star keeps its whole target.
- This holds for every caller: the film, painting and perfume facts, the Edit work dialog, and the reading dialogs (finish, past read, edit reading), where the stars sit under a "Rating" label.
- `scripts/qa/layout-audit.js`: the drifting-edge check also looks at label and value grids (a `dl` laid out as a grid). Each term's and value's first ink is measured against its own cell, up to 16px. A star drawn in layers (absolutely placed halves) counts as ink there.
- docs/03: Ratings and Phone widths say both.
- From review: the work form (Edit work and the card's quick edit) scrolls inside its dialog, and its scroller clipped what reached past it: 5px of the first star's target with a mouse, 15px on touch, and its focus ring's left side. The scroller takes `-ml-5 pl-5`, 20px of room inside the dialog's own padding. `src/__tests__/ui/rating-room.test.ts` pins that room against the touch pull.

## Completion Notes

- On a production build, the first star starts on the edge (0px off) on the film, painting and perfume pages:
  - in Chromium at 1440, 768, 390 and 320;
  - in Firefox and WebKit at 1440 and 390.
- With the old offset put back in the page, the new check reports the rating value: 6px at 1440 and 16px at 390.
- In the Edit work dialog, the first star starts on the "Rating" label's edge in Chromium (1440 and 390), Firefox and WebKit (390). The touch and alignment audits are clean there.
- `phone-audit --strict`: 0 new and 6 known findings, no overflow.
- The new grid check finds nothing else on the book, person, organization, place, publisher, reading stats and eBooks pages.
- At 320 the card check reports book cards on a publisher page 8px in. Cards hold no rating input and the card check is unchanged, so it predates this change; it was reported separately.

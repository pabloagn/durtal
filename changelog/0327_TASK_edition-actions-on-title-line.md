# Task 0327: Edition actions on the title line

**Status**: Completed
**Created**: 2026-10-05
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-476. On a book page, an edition with no ISBN and no first or limited edition mark showed its actions (Add to collection, Adjust, Match, Edit, Add instance, Delete) 9px below the cap-height center of its 21px title at 1440px.

## Implementation Details
- `src/app/library/[slug]/edition-detail-card.tsx`: the right column always rendered the ISBN row, so an empty row and its 6px gap pushed the actions down, and the 28px row then sat on the top of the title's line box, not on its cap height. The ISBN row now renders only when it has content (`hasIsbnRow`).
- Without it, the actions go through `TitleLineActions`: a slot one title line tall in the title's type, with the row on its cap-height center, as `CapAlignedControls` does. The header row is an `@container`: under 460px (a phone, a narrow column) the actions take their own line under the title and wrap, as before; from 460px they sit beside the title in one row (the row is about 410px wide).
- An edition with an ISBN or a mark is unchanged: the ISBN row on the title's line, the actions on a second line.

## Completion Notes
- Before, on localhost:3100 (main 108f59b), Chrome at 1440px: `alignment-audit.js` on The Blind Owl (an unidentified edition, no ISBN) finds the actions 8.69px below the title's cap-height center.
- After, on a preview of the backup (`preview-local.py --from-dump`), in Chrome, Safari and Firefox at 1440, 768 and 390px: `alignment-audit.js` finds 0 deviations on The Blind Owl and on 2666 (an edition with an ISBN), and no page scrolls sideways.
  - The Blind Owl at 1440 and 768: the actions sit beside the title in one row, their center 11.31px below the title's top (12.23px in Firefox), on its cap height.
  - 2666 at 1440 and 768: the ISBN on the title's line and the actions on a second line (center 40px below the title's top), as before.
  - At 390px both cards put the actions under the title, in two rows.
- `pnpm typecheck` clean, lint 0 errors, `test-local.py` 2,009 tests pass.

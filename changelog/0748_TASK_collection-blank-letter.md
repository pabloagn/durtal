# Task 0748: A collection with no artwork shows its letter (SLN-778)

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0654
**Blocks**: None

## Overview
Design polish pass 2, item 3 (`findings/design-polish-2-2026-10-15.md`). A collection with no artwork and no members' covers showed a folder icon over a small letter, on Collections and on its own page. Every other blank cover shows the title's letter (0654, `CoverLetter`).

## Implementation Details
- `src/components/collections/collection-card.tsx` and `src/app/(catalogue)/collections/[id]/page.tsx`: the blank is `CoverLetter` in a `COVER_BLANK` box, so the letter is centred and sized to the type scale (38px in the card's and the page's covers). A collection's chosen icon (SLN-336) stays beside its name; artwork and the members' cover collage are unchanged.
- Test: `src/__tests__/ui/collection-blank-letter.test.ts`.

## Completion Notes
Builds on #352 (0654).

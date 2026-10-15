# Task 0747: The palette's blank covers show the title's letter (SLN-803)

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0654
**Blocks**: None

## Overview
Design polish pass 3, item 6 (`findings/design-polish-3-2026-10-15.md`). In the command palette a book, film, perfume or painting with no cover showed its initials ("AN", "TC") on a tint taken from its name. Every other blank cover shows the title's first letter (0654, `CoverLetter`).

## Implementation Details
- `src/components/layout/command-palette.tsx`, `ResultThumb`: a work with no picture shows `CoverLetter` in its 24x36 box, which becomes the `cover` container (`COVER_BLANK`), on the plain tertiary ground like every blank cover. A person with no portrait keeps the initials on the name's tint, as on people's cards. The initials' line is trimmed to the cap height and baseline (`[text-box:trim-both_cap_alphabetic]`), as `CoverLetter`'s is, so they sit on the box's middle: before, the serif's line box put them 1px above it.
- Test: `src/__tests__/ui/palette-cover-letter.test.ts`.

## Completion Notes
Builds on #352 (0654), which adds `CoverLetter`.

# Task 0757: Form controls match the house's

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-850. Design polish pass 5, item 4 (`findings/design-polish-5-2026-10-15.md`).

- Edit work's "Recommended by" was a hand-made native select: 36px tall, larger text, a different fill.
- The credit role pickers on films, perfumes and paintings were native selects with the browser's own arrow.
- The date picker set its value a size up from the fields beside it.
- Edit work's title field (`appearance="open"`) had no inner padding, so its focus ring touched the title's first letter.

## Implementation Details
- `src/components/ui/select.tsx`:
  - `compact`: the house Select inside a line of text or a chip. It is one line tall (20px; 44px tall and wide on touch), as wide as its value, which shows whole. It has the house fill, border and chevron, and a list at least as wide as the button.
  - Options can be `disabled` (a role a house already has), shown but not chosen.
- "Recommended by" (`work-form.tsx`) is the house Select, with "Add recommender…" as its placeholder.
- The role pickers use the compact Select: `film-fields.tsx`, `perfume-fields.tsx` (the house's role and a credit's role), and `painting-fields.tsx` (attribution).
- `date-picker.tsx`: its value takes the input's size, a step up on touch as the input's does.
- `input.tsx`: an open field keeps its text on the column's edge with 8px of room inside its focus ring, which reaches 8px past the column. This applies to Edit work's title, a new collection's name and the add-book wizard's title.
- Test: `chip-touch-targets.test.ts` pins the compact Select's touch size.

## Completion Notes
See the PR for the browser checks.

# Task 0807: Suggestion titles show the focus ring in Chromium

**Status**: Completed
**Created**: 2026-10-16
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-871. The hover and focus survey (`findings/hover-focus-survey-2026-10-15.md`), item 4. On `/reading/suggestions` the 15 title links showed no focus ring in Chromium: an inline link wrapped a block span, and Chromium draws no outline round an inline box whose only child is a block. Firefox and WebKit drew it.

## Implementation Details
- `src/components/reading/suggestions/suggestion-list.tsx`: the title link is a block, as `hidden-list.tsx` already has it.

## Completion Notes
- Test: `src/__tests__/ui/suggestion-title-ring.test.ts`.

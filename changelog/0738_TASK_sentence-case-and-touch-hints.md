# Task 0738: Sentence case, no full stop after Harmonize, no key hints on touch

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-836, design-polish pass four item 8. Shipped with 0735 (SLN-833), which
renames the Provenance strings.

## Implementation Details

- Places: "Add venue" (button, tooltip and dialog title).
- A taxonomy item: "Associated works".
- Harmonize: the page title drops its accent full stop (`.h-title-dot`). On a
  coarse pointer the queue's footer, which only lists keys (J K to navigate,
  / to search), is hidden.
- Add perfume: the source field's placeholder reads "Fragrantica or Basenotes
  link", which fits a 320px phone (the longer one was cut).
- Test: `src/__tests__/provenance/pipeline-and-words.test.ts`.

## Completion Notes

See the PR for the browser checks.

# Task 0842: Finish responsive shelves and busy-state focus

**Status**: In Progress
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-889, SLN-920, SLN-944
**Blocks**: None

## Overview

Complete the outstanding grid and focus acceptance gaps after Claude's first patches were merged.

## Implementation Details

- Recommender books, the publisher loading grid and reading suggestions use their container's available width and the existing catalogue grid.
- Keep every recommended book accessible through pagination; do not hide real catalogue members to remove a partial final row.
- The first created taxonomy item returns its id and receives focus after refreshed data and dialog restoration.
- Busy saves remain focusable in film versions/copies, art objects/whereabouts, source citation and work linking. Validation still disables invalid actions and explicit save guards prevent repeats.
- Edit-copy preparation retains a focusable busy action while unsafe or invalid states remain blocked.
- Publisher submission focuses its action before disabling its fields.
- Extend the busy-button regression through computed aliases, and exercise first-item focus through a rendered component.

## Completion Notes

Focused validation is in progress. No live catalogue writes or deployment.

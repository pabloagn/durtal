# Task 0127: Smooth book backdrop boundaries

**Status**: Completed
**Created**: 2026-09-25
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-318. Remove the abrupt edge in the cover-derived background on Fictions by Jorge Luis Borges, using a shared fix for other book palettes.

## Implementation Details

- The oversized rotated/blurred blobs had visible overflow and no mask, despite the component comment claiming that all edges were feathered. On a 1,280px viewport, Borges expanded the document to 1,859px, 2666 to 1,720px, and A Void to 2,255px.
- Contain overflow inside AmbientCrystals only and intersect horizontal/vertical alpha masks. The final decorative layer fades to zero at every boundary, avoiding a visible clipping line and horizontal page overflow.
- Retain palette generation, shape geometry, blur radii, opacity, poster glow, book content, author presentation and shared application layout. No database or migration changes.

## Completion Notes

- Fresh branch/worktree: codex/sln-318-smooth-book-backdrop, based on pushed checkpoint a77941a.
- Browser comparisons on Fictions, 2666 and A Void: all three now have scrollWidth equal to the 1,274px available document width (1,280px viewport less scrollbar); all generated blob styles match the original exactly. Visually inspected the rendered fades after cover/font loading.
- A Fairly Honourable Defeat (no palette) retains its existing width and has no ambient layer before or after.
- pnpm typecheck, scoped ESLint and git diff --check pass. No new tests or dependencies for this localized CSS correction; verification uses actual browser rendering.

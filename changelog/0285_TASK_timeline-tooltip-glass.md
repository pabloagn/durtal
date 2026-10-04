# Task 0285: The timeline tooltip is glass

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0271 (stacked on it)
**Blocks**: None

## Overview
Found in the review of 0271. The tooltip on the book and author timelines (`src/components/timeline/timeline-tooltip.tsx`) drew its own panel: `bg-secondary` at 95%, a `glass-border` line, 2px corners and an inline `backdropFilter: blur(12px)`. The check that nothing but the glass blurs read class names only, so it missed the inline style.

## Implementation Details
- `src/components/timeline/timeline-tooltip.tsx`: the panel takes the `glass` class (the material, its edge, 4px corners and its shadow) with the same padding, width, type and color as before (`px-2.5 py-1.5`, 280px, `text-xs`, `fg-primary`). The inline background, border, radius and blur are gone; its position, layer and fade stay inline.
- The same file: the tooltip stays on the screen. It moved to the left of the pointer when there was no room on the right, but with no room on either side, as on a phone, it ran off the left edge (36px at 390px wide). It now keeps 8px from both edges.
- `src/__tests__/glass-surfaces.test.ts`: a second blur check reads every `.ts`, `.tsx` and `.css` file under `src` except `globals.css`, where the material is defined, and fails on `backdrop-blur`, `backdrop-filter:` or `backdropFilter:` in a style, a class constant or a stylesheet.

## Completion Notes
`scripts/qa/preview-local.py` (2026-10-04 backup), headless Chrome, a real mouse hover on a book marker (`/library`) and an author bar (`/authors`, whose tooltip waits 3 seconds) at 1440x900, 1024x900 and 390x844:

| | Before (#55) | After |
|---|---|---|
| Panel | `bg-secondary` at 95%, `blur(12px)` on the element, 1px border, 2px corners | `glass`: no fill or blur of its own; `::before` `rgba(10,13,16,0.88)`, `blur(24px) saturate(1.5) brightness(0.3)`; 4px corners |
| Lowest text contrast, read from the screen | | 4.99:1 on the glass (author dates); 4.64:1 for the letter on the no-cover frame inside it |
| Position at 390px | 36px off the left edge | 8px from the left edge |

- The new blur check fails on #55's tooltip (`components/timeline/timeline-tooltip.tsx`) and passes now.
- `scripts/qa/alignment-audit.js`: 0 rows over 0.5px with each tooltip open, at all three widths. `scripts/qa/design-audit.js`: 0 low-contrast texts, 0 nested controls.
- `scripts/qa/page-weight.js`: 9 of 10 routes pass; the one over is the known `/library` overage on `main`.
- `pnpm typecheck`, `pnpm lint` (0 errors) and `python3 scripts/qa/test-local.py` (1,613 tests) pass.

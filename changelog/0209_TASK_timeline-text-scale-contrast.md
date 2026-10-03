# Task 0209: Timelines: text on the type scale and at 4.5:1

**Status**: In Progress
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-404. The author timeline (`/authors`, timeline view) and the book timeline (`/library`, timeline view) set their text with inline styles: 9, 10 and 11px, mostly in `fg-muted`, under 4.5:1. Now all timeline text uses the scale (12px `text-micro` or larger) in `fg-secondary` or brighter. Work on this found three older faults in the same components; two are fixed here, one is a separate issue.

## Implementation Details

- `author-timeline-row.tsx`:
  - The years at the bar ends are removed. They hung 14px under the bar, and the bar has `overflow: hidden`, so they never showed (since e4042b7). The hover card shows the life dates.
  - The name in the bar: 12px, `fg-primary` (was 11px at opacity 0.8), 16px line so descenders are not cut.
  - The letter in a portrait with no photo: 12px `fg-secondary` on the author's `Monogram` tint (was 9px `fg-muted`, 2.15:1).
  - The bars take the pointer (`pointer-events: auto`). The rows layer sets `pointer-events: none`, and the bars inherited it, so hovering never highlighted a bar or opened the card.
- `author-timeline.tsx`, hover card: letter 21px on the `Monogram` tint, name 14px serif, nationality, life dates and work count 12px `fg-secondary` (were 11 and 10px, `fg-muted`).
- `timeline-axis.tsx` (SVG): decade and year labels 12px `fg-secondary` (were 11px and 9px `fg-muted`, 2.45:1 and 1.74:1); the century year at full `fg-secondary` (was opacity 0.8, 3.7:1). Classes (`fill-*`, `text-micro`) instead of presentation attributes.
- `work-timeline-marker.tsx`:
  - Title 12px serif `fg-primary`, author 12px `fg-secondary` (were 10px and 9px at 1.94:1). CSS ellipsis only; the JS truncation is gone.
  - Layout from fixed constants, top to bottom: title, cover, diamond, author. The lane height stays 80px; the title no longer starts above the lane (under the axis), and the cover no longer moves on hover.
  - A label is as wide as the room to the nearest marker in its lane allows (72 to 128px, 8px gap), and is hidden with less room, so two labels never overlap. `labelWidth()` and `LABEL_ROOM` are exported.
- `work-timeline.tsx`:
  - Lanes keep markers `LABEL_ROOM` (80px) apart at scale 1 (was 60px), so every label shows at the default zoom. `laneGaps()` gives each work the distance to its nearest lane neighbor.
  - Hover card: title 14px, author, year and editions 12px `fg-secondary`; the status uses the shared `Badge` and `STATUS_CONFIG` (the card had its own colors: wanted rose, shortlisted gold, on order blue, against gold, blue and rose everywhere else).
  - Empty state 14px `fg-secondary`.
- `timeline-canvas.tsx`, `timeline-minimap.tsx`: the canvas fills its parent (the shells' `h-[calc(100vh-220px)]` box) and scrolls inside it. The content area is as tall as the rows (`contentHeight` prop). Before, the canvas was as tall as all rows (8,260px on `/library`), so it never scrolled itself: the sticky axis did not stick, and the minimap and zoom controls sat at the top, over the first lane and the first author row. Now the axis sticks to the top, and the minimap (`MINIMAP_HEIGHT`) and the zoom controls stick to the bottom.
- `src/components/shared/no-photo.tsx`: `monogramTint(name)` exported, used by `Monogram` and the timelines.

## Completion Notes

Before (dev server, 1440x900):

- `/authors` timeline: `scripts/qa/design-audit.js` 3 texts under 4.5:1 (9px letter 2.15:1; 10px years 2.45:1); axis by hand: 12px at 3.7:1, 11px at 2.45:1, 9px at 1.74:1. Sizes 9, 10, 11px.
- `/library` timeline: 7 texts under 4.5:1 (author names, 9px, 1.94:1); hover card year and editions 2.34:1; sizes 9, 10, 11, 13px. Author names overlapped at scale 0.57 (14.4px and 11.2px).

After, measured so far on `/library`:

- Default zoom: design audit 0 texts under 4.5:1; sizes 12 and 14px in the canvas; axis 12px at 5.28:1, 14px at 11.8:1.
- 0 label overlaps at 12 zoom levels from the farthest to the closest (1780 to 1830).
- Names cut at the default zoom: 6 of 14 labels (3 are long titles), was 9 of 14 with fixed 72px labels.
- Canvas 680px, scrolls inside; axis at the top and minimap at the bottom after scrolling 600px and to the end.
- `pnpm typecheck` and eslint pass.

Left:

- [ ] Dense decades (1960, 2000) at the default zoom and two steps out: 0 overlaps between labels. A first scan found only labels under the sticky axis and zoom buttons; the refined check timed out in the browser.
- [ ] `/authors` timeline after: design audit, axis by hand, hover a bar (card after 3 s), the 6 `Monogram` tints at 4.5:1 or more, the bar name over the gradient (computed 5.6:1 at the rose end on hover).
- [ ] `scripts/qa/alignment-audit.js` on both views.
- [ ] 375px (SLN-312).
- [ ] Before and after images and evidence in SLN-404.

Not fixed here: clicks on timeline items do nothing. The canvas captures the pointer on `pointerdown` (`use-timeline-transform.ts`), so the `click` goes to the canvas, not to the marker or bar. Separate issue.

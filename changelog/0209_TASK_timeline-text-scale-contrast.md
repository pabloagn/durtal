# Task 0209: Timelines: text on the type scale and at 4.5:1

**Status**: Completed
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
  - The letter in a portrait with no photo: 12px `fg-primary` on the author's `Monogram` tint (was 9px `fg-muted`, 2.15:1). `fg-secondary` is not enough there: on the 18% tint it reaches only 4.02 to 4.81:1, under 4.5:1 for four of the six tones (gold 4.02, sage 4.19, blue 4.31, slate 4.45). `fg-primary` reaches 8.98:1 or more.
  - The bars take the pointer (`pointer-events: auto`). The rows layer sets `pointer-events: none`, and the bars inherited it, so hovering never highlighted a bar or opened the card.
- `author-timeline.tsx`, hover card: letter 21px `fg-primary` on the `Monogram` tint (same reason), name 14px serif, nationality, life dates and work count 12px `fg-secondary` (were 11 and 10px, `fg-muted`).
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
- `src/components/shared/no-photo.tsx`: `monogramTint(name)` exported, used by `Monogram` and the timelines. The `tint()` comment said the base keeps `fg-secondary` above 4.5:1; that holds up to 10% only (4.55:1), so the comment now says so. The `Monogram` letter itself (46px, needs 3:1) is unchanged.

## Completion Notes

Before (dev server, 1440x900):

- `/authors` timeline: `scripts/qa/design-audit.js` 3 texts under 4.5:1 (9px letter 2.15:1; 10px years 2.45:1); axis by hand: 12px at 3.7:1, 11px at 2.45:1, 9px at 1.74:1. Sizes 9, 10, 11px.
- `/library` timeline: 7 texts under 4.5:1 (author names, 9px, 1.94:1); hover card year and editions 2.34:1; sizes 9, 10, 11, 13px. Author names overlapped at scale 0.57 (14.4px and 11.2px).

After. Measured with headless Chrome at 1440x900 against `scripts/qa/preview-local.py --from-dump` (a local copy of the live data, 548 works and 674 authors on the timelines), on main at c9f6359 plus this branch:

- Design audit: `/library` and `/authors` timeline views, 0 texts under 4.5:1; sizes 12, 14, 16, 30 and 46px only. Same with a hover card open on each (adds 21px for the author card letter).
- Alignment audit: 0 issues on both views (21 and 22 icons checked).
- Axis (SVG, by hand): 12px at 5.28:1, 14px at 11.8:1, at every zoom level.
- Canvas text: 12 and 14px only. Lowest contrast on a known background: 4.64:1 (`fg-secondary` initial on a cover with no image, `bg-tertiary`). Bar name over its gradient: 7.63:1 at rest, 5.58:1 on hover (worst era fill, worst end).
- Overlaps: 0 between labels in every lane (not only the visible ones), and 0 between axis labels, at 14 zoom levels from the farthest (0.05) to the closest (15): `/library` around 1810, 1960 and 2000 (up to 1,040 labels at once), `/authors` around 1850 and 1950 (up to 1,059 labels).
- Names cut with an ellipsis at the default zoom: 6 of 21 labels around 1800.
- 375x812: 0 texts under 4.5:1, 0 alignment issues, 0 overlaps. The page is wider than the screen and the canvas box runs below it, so the minimap and zoom buttons are off screen; that is the phone layout of SLN-312, not this task.
- `pnpm typecheck`, eslint and `python3 scripts/qa/test-local.py` pass.

Found and left alone:

- `scripts/qa/design-audit.js` reads only `rgb()` colors. A `color-mix()` background computes to `oklab(...)`, so the audit skips it and measures against the parent instead. That is how the no-photo letters passed the audit at 4.02:1.
- On `/library`, a work's lane stays taken until its last edition, so the old works with modern editions fill the first lanes up to the present. Around 1960 the first lanes on screen are empty and the books start lower down. Older than this task.

Not fixed here: clicks on timeline items do nothing (SLN-413). The canvas captures the pointer on `pointerdown` (`use-timeline-transform.ts`), so the `click` goes to the canvas, not to the marker or bar.

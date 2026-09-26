# Task 0138: Author banner spans the full width

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-325: On `/authors/[slug]`, the background banner stopped at the edges of the centered content column, leaving dark gutters on wide screens. It must always fill the full width of the main area, from the sidebar edge to the right edge of the window, at every window and sidebar width.

## Implementation Details

- Cause: the shell puts every page in `mx-auto max-w-6xl px-6`. The banner wrapper used `-mx-6`, so it could only reach the column edges.
- Rejected pure-CSS options: `container-type` on an ancestor makes it the containing block for fixed elements (the bulk-action toolbars render in-page); `100vw` counts the scrollbar and causes horizontal scroll; a grid shell changes the layout of every page (margin collapsing, stretched inline items).
- `src/components/shared/full-bleed-layer.tsx`: client layer that fills its positioned parent vertically. It measures the parent and `main`, then writes left/right offsets straight to the element inside a `ResizeObserver` callback, so the browser applies them in the same frame (window resize, sidebar drag, sidebar collapse animation). It never extends past `main`. It is hidden until the first measurement, then fades in over 300ms.
- `src/lib/utils/full-bleed.ts`: pure inset math, clamped at zero.
- `src/app/authors/[slug]/page.tsx`: the banner layer uses `FullBleedLayer`. Header content stays in the centered column.
- `author-detail-header.tsx`: the name/actions row wraps, so Export and the menu move below the name when the column is narrow instead of overflowing (100px horizontal scroll at 768px before, also on the old code).
- The book page uses the same backdrop pattern and is unchanged; it can adopt `FullBleedLayer` later.

## Completion Notes

- 4 unit tests for the inset math. Full suite, typecheck, lint and production compile pass.
- Browser checks on a preview of this branch (read-only against live data), László Krasznahorkai: layer edges equal `main` edges at 1024, 1414, 1920 and 2560px, with the sidebar expanded (224px), collapsed (56px) and mid-animation; horizontal scroll 0. At 768px the actions wrap below the name; horizontal scroll 0 (was 100). Authors without a banner are unchanged.
- Test note: the in-app browser pane was hidden, which pauses rendering and ResizeObserver delivery; measurements were taken after forced renders.
- Phones: the banner matches `main`, but the 224px sidebar leaves 151px of content at 375px. That belongs to SLN-312.

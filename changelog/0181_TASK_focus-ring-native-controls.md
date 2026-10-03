# Task 0181: One rose focus ring, dark native controls, no page jump

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-387. Keyboard focus showed the browser's orange ring on most controls, a grey ring on others and no ring on some. Native controls used the light system look. Centred pages moved 3px between pages with and without a scrollbar.

## Implementation Details

- `src/styles/globals.css`: `html` gets `color-scheme: dark`, `accent-color: var(--color-accent-rose)` and `overflow-y: scroll`. One `:focus-visible` rule in the base layer: 1px rose outline, 2px offset. Text fields keep their own rose border (`focus:outline-none`), so the rule sits in the base layer where utilities can replace it.
- Removed the four local ring styles (ring-1, ring-2, grey inset outline, rose outline without offset) from Button, pagination, field actions, copy button, timeline zoom, dialog close, carousel arrows, card overlay links, icon pickers, mark toggle, book links and the image adjustment editor. Removed `focus:outline-none` from the action menu trigger and the lightbox close button, which had no other focus style.
- Rings that a container would clip are drawn inset (`-1px` offset):
  - `CapAligned` clips by design, so it insets every ring inside it (`[&_:focus-visible]:-outline-offset-1`).
  - The sidebar search button (its container has no top padding).
  - The author poster button (it fills a frame that hides overflow).
  - Harmonize queue rows (the queue scrolls). Harmonize no longer uses its own gold ring.
- `HorizontalCarousel`: the scroller gets `p-1 -m-1 scroll-px-1`, room for the ring with no change in layout (first card stays on the heading's left edge).
- Venue card: the title link is out of the Tab order; the image link above goes to the same page. One Tab stop per card.
- Field focus borders that were plum, grey or barely visible (filter search, reader search, mark date, comment editor) are rose, like every other field.

## Completion Notes

Measured on the dev server at 1440×900, with a real Tab key and transitions off:

- 16 pages and the Edit Work dialog: every focusable control shows the rose ring (2px offset, or inset where clipped); text fields and select triggers show the rose border. 0 controls without a focus style, 0 clipped rings.
- `/places`: 177 Tab stops before, 129 after.
- `h1` left edge 277px on `/taxonomy` (no scrollbar) and `/library` (scrollbar); before, 280px and 277px.
- Native `<select>`: `color-scheme: dark`.
- `scripts/qa/alignment-audit.js`: no new deviations. The known ones (book page +0.61px, comment editor −0.52px, Provenance stat cards) are tracked in SLN-392.
- `pnpm typecheck` and eslint on the changed files pass.
- The dev server on :3100 had stopped picking up file changes (no rebuild since about 02:30). Restarted it, with a fresh Turbopack cache (the old 12GB cache served stale CSS).

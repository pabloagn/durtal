# Task 0377: The sidebar's logo, Search and links are 44 px on touch

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-541, found while checking 0375 (#156). On a tablet (a coarse pointer at
768 or 1024 px), the sidebar shows, and its logo, Search and 18 links were
under the 44 px a finger needs: 38 px high in the full sidebar, and 30 px
high and 31 px wide in the 56 px icon rail. In the phone drawer, the
"Durtal" logo was 38 px high.

## Implementation Details

All in `src/components/layout/sidebar.tsx`, and only on a coarse pointer:

- Search and each link are at least 44 px high (`pointer-coarse:min-h-11`)
  and take `touch-hit`, which gives them a 44 px wide press area in the
  rail. The logo link takes `touch-hit`.
- 18 links of 44 px do not fit in a 900 px window, so the navigation
  scrolls. Its scrollbar is hidden on touch (`scrollbar-hide`): a finger
  scrolls it, and in Firefox a 15 px scrollbar left the rail's links 16 px
  wide.
- With a mouse nothing changes.

## Completion Notes

- Production builds of main (6ed7c4f7) and this branch on the newest backup,
  `/library`, in headless Chrome, Firefox and WebKit at 1440 px with a mouse,
  and at 1024, 768 and 390 px (the drawer open) with a coarse pointer:
  - Main: the touch audit found 20 targets under 44 px at 1024 and at 768
    px, and the logo at 390 px.
  - This branch: the touch audit and the press-area overlap check find
    nothing at 1024, 768 and 390 px. Search and the links are 44 px high,
    and the navigation scrolls with no scrollbar width.
  - 1440 px: the logo, Search and every link have the same position and
    size as on main (0 px difference) in all three browsers.
  - The alignment, design and overflow audits find nothing at any width.
    `page-weight.js` passes.
- A first version without the hidden scrollbar passed in Chrome and WebKit,
  but in Firefox at 768 px the scrollbar left the links 16 px wide and the
  touch audit found 18 press areas clipped to 42 px.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 262 files, 2,953 tests, all passed.

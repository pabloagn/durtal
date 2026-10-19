# Task 0956: A leader menu opened under a resting pointer starts on its first item

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

A leader menu (G, N, E, Y, R) opened from the keyboard started on whichever item appeared under a pointer at rest. The browser fires mouseenter for an element that appears under the pointer, and each item took the active place on mouseenter. With the pointer at 720,400, G then Enter went to Paintings, and since #507 a screen reader announced that item. Source: findings/regression-sweep-2026-10-18.md. Fixes SLN-1189.

## Implementation Details

- `src/components/shortcuts/leader-menu.tsx`: items follow `onPointerMove` instead of `onMouseEnter`. The menu's first pointer event only records where the pointer is, and an item takes the active place once the pointer has moved. The palette works the same way. Clicks and taps are unchanged.
- Test: `src/__tests__/ui/leader-menu-focus.test.ts` adds "starts on its first item under a resting pointer, and follows a moving one". It fails without the change.

## Completion Notes

Checked on a production build in headless Chromium, Firefox and WebKit at 1440, 390 and 320. The pointer rested over the second item of the G, N, E, Y and R menus, then each menu was opened from the keyboard. Every menu opened on its first item, and moving the pointer one step picked the item under it. G then Enter went to the dashboard. The alignment audit found 0 issues on /library and the dashboard, page weight is within budget, and the UI tests passed (1,143).

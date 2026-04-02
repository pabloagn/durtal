# Task 0069: Timeline Scroll and Zoom Keybindings

**Status**: Completed
**Created**: 2026-03-31
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview
Changed timeline scroll/zoom behavior: plain mouse scroll now scrolls vertically through the timeline, and Ctrl+Mouse Scroll zooms in/out. Previously, all scrolling triggered zoom, making vertical navigation impossible.

## Implementation Details
- Modified `src/components/timeline/timeline-canvas.tsx`
- Plain mouse scroll: passes through to native browser scroll (no `preventDefault`), allowing vertical scrolling through the timeline
- Ctrl+Mouse Scroll (or Cmd+Scroll on Mac): zooms in/out centered on cursor position (with `preventDefault`)
- Shift+Mouse Scroll / horizontal scroll: still pans horizontally
- Changed container style from `overflow: hidden` to `overflowX: hidden; overflowY: auto` to enable vertical scrolling
- Zoom controls and minimap changed from `position: absolute` to `position: sticky` so they remain visible during scroll

## Completion Notes
The timeline now scrolls vertically with a regular mouse wheel, and zooms in/out with Ctrl+Scroll. This matches standard browser interaction patterns and eliminates the problem of getting lost while scrolling through many authors.

# Task 0070: Timeline Sticky Year Axis Header

**Status**: Completed
**Created**: 2026-03-31
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0069
**Blocks**: None

## Overview
Made the timeline year axis header sticky so it remains visible at the top when scrolling vertically through authors. Previously, the axis disappeared when scrolling down, leaving no reference for which year range was visible.

## Implementation Details
- Modified `src/components/timeline/timeline-axis.tsx`
  - Changed axis container from `position: absolute` to `position: sticky; top: 0`
  - Increased header height from 44px to 52px for better readability
- Modified `src/components/timeline/timeline-canvas.tsx`
  - Changed content area from `position: absolute; top: AXIS_HEADER_HEIGHT` to `position: relative`
  - Removed the outer scroll wrapper from `author-timeline.tsx` since the canvas itself handles scrolling

## Completion Notes
The year axis now sticks to the top of the timeline viewport as the user scrolls down through authors. Century, decade, and year labels remain visible at all times, providing continuous context for the horizontal timeline position.

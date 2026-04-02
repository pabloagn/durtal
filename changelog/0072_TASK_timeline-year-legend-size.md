# Task 0071: Timeline Year Legend Font Size Increase

**Status**: Completed
**Created**: 2026-03-31
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Year legends in the timeline were far too small to read. Increased font sizes across all timeline axis labels.

## Implementation Details
- Modified `src/components/timeline/timeline-axis.tsx`
- Century labels: 11px -> 14px, color upgraded from `fg-secondary` to `fg-primary`
- Century year numbers: 9px -> 12px, color upgraded to `fg-secondary`, opacity 0.7 -> 0.8
- Decade labels: 9px -> 11px
- Individual year labels: 7px -> 9px
- Axis header height: 44px -> 52px to accommodate larger labels
- Adjusted vertical positioning (centuryLabelY, decadeLabelY) for better spacing

## Completion Notes
All year legends in the timeline are now clearly readable at default zoom levels. Century markers are most prominent, with decades and individual years scaled proportionally.

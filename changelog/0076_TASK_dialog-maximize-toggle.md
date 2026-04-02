# Task 0076: Dialog Maximize/Expand Toggle

**Status**: Completed
**Created**: 2026-03-31
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0077
**Blocks**: None

## Overview
Add a maximize/expand toggle button to the Dialog component header, next to the close (X) button. Clicking it expands the dialog to a larger (but not full-screen) size for a more comfortable editing experience. Clicking again returns to the default size. Follows the Linear.app pattern where the expand icon sits in the top-right header area.

## Implementation Details

### Dialog component changes (`src/components/ui/dialog.tsx`)
- Added `expandable` prop (default `true`)
- Added `expanded` state, resets when dialog closes
- Renders Maximize2/Minimize2 icon button to the left of the close (X) button
- When expanded: width overrides to `max-w-5xl` regardless of the dialog's default size
- When collapsed: returns to the dialog's `className`-driven size (or default `max-w-2xl`)
- Smooth CSS transition on max-width via `transition-[max-width] duration-200 ease-out`
- Button tooltip: "Expand" / "Collapse"
- `expandable={false}` used on DeleteConfirmDialog and Location Delete

## Completion Notes
All data-editing dialogs now have the expand toggle. Confirmation-only dialogs (delete confirm, location delete) opt out via `expandable={false}`. The expanded state persists within a dialog session but resets on close.

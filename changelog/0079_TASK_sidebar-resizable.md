# Task 0079: Resizable Sidebar

**Status**: Completed
**Created**: 2026-03-31
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview
Make the sidebar horizontally resizable by dragging its right edge. When collapsed below a threshold, switch from full mode (icon + label) to compact mode (icon only). Persist the user's preferred width in localStorage.

## Implementation Details

### Interaction
- A thin drag handle on the sidebar's right edge allows horizontal resizing.
- Drag handle shows a subtle visual affordance on hover (e.g. faint vertical line / cursor change to `col-resize`).
- Double-clicking the drag handle toggles between expanded (default 224px) and collapsed (icon-only) states.

### Width Breakpoints
| State | Width | Content |
|---|---|---|
| Expanded (default) | 224px (`w-56`) | Icon + label |
| Collapsed | 56px | Icon only, centered. Tooltip on hover showing label. |
| Custom | 120px - 360px | User-dragged width. Below 120px snaps to collapsed. |

### Resize Behavior
- Min width: 56px (collapsed / icon-only).
- Max width: 360px.
- Snap threshold: dragging below 120px snaps to 56px (collapsed). Dragging from collapsed past 120px snaps to 224px (default).
- The main content area (`ml-56` in Shell) dynamically adjusts its left margin to match the sidebar width.

### Persistence
- Store sidebar width in `localStorage` under key `durtal-sidebar-width`.
- On mount, read stored width; fall back to 224px if absent.

### Collapsed Mode Details
- Nav items render icon only, horizontally centered.
- Active state styling still applies (plum background + rose border).
- Search button shows magnifying glass icon only.
- Logo section shows "D" monogram or just the icon.
- Footer tagline hidden.
- Hovering a nav item shows a tooltip with the label text.

### Technical Approach
- Add a `SidebarResizeHandle` element on the right edge of the sidebar.
- Use `mousedown` / `mousemove` / `mouseup` events (with pointer capture) for drag logic.
- Track `sidebarWidth` state in the Shell component and pass down as prop / context.
- Derive `isCollapsed` from `sidebarWidth <= 56`.
- Animate transitions when snapping (not during active drag).
- Use CSS `transition` on width only when not actively dragging (to keep drag responsive).

### Files to Modify
- `src/components/layout/sidebar.tsx` — resize handle, collapsed rendering, tooltip support.
- `src/components/layout/shell.tsx` — sidebar width state, dynamic margin, localStorage persistence.
- `src/styles/globals.css` — drag handle cursor styles if needed.

## Completion Notes
Implemented in `sidebar.tsx` and `shell.tsx`. No new files or dependencies added.

- **shell.tsx**: Added `sidebarWidth` state initialized from `localStorage` on mount (default 224px). Dynamic `marginLeft` style on `<main>` replaces the static `ml-56` class. Width changes are persisted to `localStorage` via `handleSidebarWidthChange`.
- **sidebar.tsx**: Accepts `width` and `onWidthChange` props. Derives `isCollapsed` from `width <= 56`. Resize handle is a 6px-wide absolute-positioned div on the right edge using pointer capture events. Snap logic: below 120px collapses to 56px, max 360px. Double-click toggles between collapsed and default. During drag, CSS width transitions are disabled for responsiveness; body `user-select` and cursor are locked to `col-resize`. In collapsed mode: logo shows "D", search shows icon only, nav items are icon-only centered with CSS group-hover tooltips, footer is hidden. Typecheck passes clean.

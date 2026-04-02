# Task 0084: Drag-and-Drop Order Kanban

**Status**: Completed
**Created**: 2026-04-01
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0083
**Blocks**: None

## Overview
The provenance pipeline kanban board currently displays orders in status columns but offers no drag-and-drop interaction. Add the ability to drag order cards between status columns to update their status automatically. Dropping a card into a new column should call `updateOrderStatus` and record the transition in `order_status_history`.

## Requirements

### Drag-and-Drop Mechanics
- Use a lightweight drag-and-drop library (e.g., `@dnd-kit/core` + `@dnd-kit/sortable`) -- Framer Motion's `Reorder` is insufficient for cross-container drags
- Each pipeline column is a droppable zone
- Each order card is a draggable item
- Visual feedback during drag: ghost card with reduced opacity at origin, highlighted drop target column with border/glow
- Smooth animation on drop (card slides into new column position)
- Optimistic UI update: move card immediately, revert on server error

### Status Validation on Drop
- Only allow drops into columns that represent valid transitions for the order's acquisition method
- Invalid drop targets should appear visually disabled (dimmed, no highlight) during drag
- If dropped on an invalid column, card snaps back to origin with no state change
- Skipping statuses is allowed (e.g., drag from "Placed" directly to "Shipped") per Task 0083 rules

### Status History
- Each drag-drop status change creates an `order_status_history` entry with `fromStatus` and `toStatus`
- Auto-populate date fields on relevant transitions:
  - Dropped into "Shipped" or "In Transit": set `shippedDate` to today if not already set
  - Dropped into "Delivered": set `actualDeliveryDate` to today if not already set

### Immediate Acquisitions
- Orders in the "Recent Acquisitions" section (in_store_purchase, gift, event_purchase) are NOT draggable -- they have no pipeline to traverse

### Accessibility
- Keyboard support: select a card, arrow keys to move between columns, Enter to confirm drop
- Screen reader announcements for drag start, over target, and drop result

### Performance
- Debounce rapid drags (prevent double-firing if user drags quickly)
- Loading indicator on the moved card while the server action completes

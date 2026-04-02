# Task 0085: Calendar Date Picker for Order Dates

**Status**: Completed
**Created**: 2026-04-01
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0060
**Blocks**: None

## Overview
The order creation and edit dialogs currently use plain `<input type="date">` for date fields (order date, estimated delivery date, actual delivery date, shipped date). Replace these with a proper calendar picker component that matches the app's dark-mode gothic-minimal design language. The native date input is inconsistent across browsers and looks out of place.

## Requirements

### Calendar Picker Component
- Use shadcn/ui's `Calendar` component (built on `react-day-picker`) -- already available in the design system
- Wrap in a `Popover` trigger: clicking the date field opens a calendar dropdown
- Display selected date in the input field formatted as `YYYY-MM-DD`
- Allow clearing the date (set to null) for optional date fields
- Support min/max date constraints where relevant:
  - `orderDate`: no future constraint (user may pre-register upcoming orders)
  - `estimatedDeliveryDate`: must be >= `orderDate`
  - `actualDeliveryDate`: must be >= `orderDate`
  - `shippedDate`: must be >= `orderDate`

### Styling
- Dark background matching dialog panels
- Muted accent color for selected date, today indicator
- 2px border radius (per design language)
- Serif month/year header (EB Garamond), sans day labels (Inter)
- Navigation arrows using Lucide icons (ChevronLeft, ChevronRight)

### Apply To
- Order create dialog (Step 3: all date fields)
- Order edit dialog (Task 0083: all date fields)
- Any other date inputs in the provenance pipeline

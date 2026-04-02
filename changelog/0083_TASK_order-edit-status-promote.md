# Task 0083: Order Edit Dialog & Status Promotion UI

**Status**: Completed
**Created**: 2026-04-01
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0060
**Blocks**: 0084

## Overview
There is currently no way to edit an existing order or manually promote its status through the UI. The detail panel shows a "Mark as [next]" button but there is no full edit dialog, no way to jump statuses, and no way to correct data entry mistakes (wrong price, wrong carrier, wrong dates, etc.). Add a proper order edit dialog accessible from the detail panel, and a more flexible status promotion mechanism that allows selecting any valid next status (not just the linear next one).

## Requirements

### Order Edit Dialog
- Accessible from the order detail panel (edit icon/button)
- Pre-populated with all current order fields
- Same field layout as the create dialog but with all steps visible/collapsible (not a wizard -- editing should not force stepping through pages)
- Editable fields: acquisition method, order date, price, shipping cost, currency, carrier, tracking number, tracking URL, order confirmation, order URL, estimated delivery date, actual delivery date, venue, destination location, notes
- Work and edition should be changeable (with the same search UI as create)
- On save, calls `updateOrder` server action and refreshes the pipeline
- Validation: same as create (order date required, prices numeric, etc.)

### Status Promotion
- Replace the single "Mark as [next]" button with a dropdown or segmented control showing all valid transitions for the current acquisition method
- For `online_order`: full linear pipeline (placed -> confirmed -> processing -> shipped -> in_transit -> out_for_delivery -> delivered)
- For `auction`: bid -> won -> shipped -> in_transit -> out_for_delivery -> delivered
- For immediate methods: single terminal status (purchased/received)
- Allow skipping intermediate statuses (e.g., placed -> shipped directly) since real-world orders sometimes skip stages
- Include cancel/return as always-available options (with confirmation)
- Each transition creates an `order_status_history` entry
- Optional notes field on status change (e.g., "Customs delay", "Wrong item shipped")

### Detail Panel Enhancements
- Add edit button (pencil icon) in the detail panel header
- Add delete button (with confirmation) for non-delivered orders
- Show full status history timeline from `order_status_history` table (currently schema-only, not rendered)

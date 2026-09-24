# Task 0112: Update Data Model Documentation

**Status**: Completed
**Created**: 2026-04-06
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0097
**Blocks**: None

## Overview
`docs/02_DATA_MODEL.md` is missing documentation for 12+ tables that have been added since the initial spec. These tables are in the schema but undocumented.

## Implementation Details
Tables to document:
- `work_status_history` — audit trail for catalogue status changes
- `instance_status_history` — audit trail for instance status changes
- `order_status_history` — audit trail for order status transitions
- `orders` — acquisition/order tracking
- `venues` — bookshop/vendor management
- `calibre_books` — Calibre digital library sync
- `reading_progress` — e-reader progress tracking
- `comments` + `comment_attachments` — comment system
- `activity_events` — activity timeline
- `gallery_layouts` — collage layout caching
- `publishing_houses` + `publishing_house_specialties` — publisher reference

Also update the "contributor" role list to match what code will have after Task 0098.

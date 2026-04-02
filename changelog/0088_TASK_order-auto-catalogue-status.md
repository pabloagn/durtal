# Task 0088: Automatic Catalogue Status on Order Lifecycle

**Status**: Completed
**Created**: 2026-04-01
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0060
**Blocks**: None

## Overview
When an order is created or its status changes, the associated work's `catalogueStatus` should update automatically:

- **Order created** (any initial status except delivered/purchased/received): work -> `on_order`
- **Order reaches delivered/purchased/received** (book is in hand): work -> `accessioned`

Both transitions are recorded in `work_status_history` and fire `recordActivity` events.

## Rules
1. `createOrder()`: after inserting the order, read the work's current `catalogueStatus`. If the order's initial status is `delivered`, `purchased`, or `received`, set the work to `accessioned`. Otherwise, set it to `on_order`. Record the transition in `work_status_history` and `recordActivity`.
2. `updateOrderStatus()`: when the new status is `delivered`, `purchased`, or `received`, set the work to `accessioned`. Record the transition in `work_status_history` and `recordActivity`.
3. Skip the update if the work is already in the target status (no duplicate history entries).
4. `cancelled` and `returned` do NOT automatically change catalogue status.

## Implementation Details
- Modified file: `src/lib/actions/orders.ts`
- New imports: `works`, `workStatusHistory` from schema; `recordActivity` from activity module; `invalidate`, `CACHE_TAGS` from cache
- Helper function `syncWorkCatalogueStatus(workId, targetStatus, notes)` to avoid code duplication between `createOrder` and `updateOrderStatus`

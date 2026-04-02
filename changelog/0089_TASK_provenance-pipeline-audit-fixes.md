# Task 0089: Provenance Pipeline Audit Fixes

**Status**: Completed
**Created**: 2026-04-02
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0060
**Blocks**: None

## Overview

Comprehensive audit of the provenance/orders feature uncovered 23 issues across data integrity, UI consistency, and validation. This task tracks all fixes grouped by severity.

---

## CRITICAL

### C1. Cancellation/return never reverts work catalogue status
- **Location**: `src/lib/actions/orders.ts:532-539`
- **Problem**: `syncWorkCatalogueStatus` is only called when `newStatus` is in `BOOK_IN_HAND_STATUSES` (`delivered`, `purchased`, `received`). When an order moves to `cancelled` or `returned`, the work stays stuck in `on_order` or `accessioned` respectively.
- **Fix**: After any status change, derive the correct work status by querying ALL orders for the work. If no remaining active/delivered order justifies the current status, revert it.

### C2. `deleteOrder` doesn't sync work status or record history
- **Location**: `src/lib/actions/orders.ts:544-559`
- **Problem**: Deletes the order row but never calls `syncWorkCatalogueStatus`. No history entry or activity event recorded. Deletion is invisible in the audit trail.
- **Fix**: Before deletion, record an `orderStatusHistory` entry (to `deleted`), call `syncWorkCatalogueStatus` using the same multi-order derivation from C1, and record an activity event.

### C3. Auction orders invisible in UI
- **Location**: `src/app/provenance/provenance-shell.tsx:1011-1016`
- **Problem**: `immediateOrders` only includes `in_store_purchase`, `gift`, `event_purchase`. The pipeline kanban only shows `PIPELINE_COLUMNS` (placed-delivered). Auction orders with status `bid` or `won` appear in neither section.
- **Fix**: Add an "Auction" section similar to "Immediate Acquisitions", or extend the pipeline to include auction columns when auction orders exist.

### C4. `won` is marked terminal but shouldn't be
- **Location**: `src/lib/constants/orders.ts:31`
- **Problem**: `TERMINAL_STATUSES` includes `won`. But the auction pipeline is `bid -> won -> shipped -> ... -> delivered`. Since `won` is terminal, `getValidTransitions` returns `[]` at line 198, making auction orders stuck at `won` forever.
- **Fix**: Remove `won` from `TERMINAL_STATUSES`.

### C5. No server-side status transition validation
- **Location**: `src/lib/actions/orders.ts:491-542`
- **Problem**: `updateOrderStatus` accepts any `newStatus` without checking if the transition is valid for the current status and acquisition method. Validation only exists client-side in `getValidTransitions`.
- **Fix**: Move `getValidTransitions` (or equivalent logic) to a shared module, call it in `updateOrderStatus`, and throw if the transition is invalid.

### C6. Auto-set dates unconditionally overwrite existing values
- **Location**: `src/lib/actions/orders.ts:506-517`
- **Problem**: Moving to `shipped` always sets `shippedDate = today` even if a user-entered date already exists. Same for `actualDeliveryDate`. Retroactive status updates record the wrong date.
- **Fix**: Only set auto-dates when the field is currently null: `additionalFields.shippedDate = currentOrder.shippedDate ?? today`.

---

## HIGH

### H1. Price "0" treated as null in create and edit dialogs
- **Location**: `order-create-dialog.tsx:679`, `order-edit-dialog.tsx:90`
- **Problem**: `details.price ? details.price : null` — a price of `"0"` is falsy and becomes `null`. Free books or zero-cost gifts lose their price. Same for shipping cost. The `totalCost` calculation (`priceVal && shippingVal`) also breaks on `"0"`.
- **Fix**: Use `details.price !== "" ? details.price : null` (and same for `shippingCost`). Fix totalCost to handle zero values.

### H2. Create dialog allows any initial status for any method
- **Location**: `order-create-dialog.tsx:57-71`
- **Problem**: `ORDER_STATUS_OPTIONS` lists all 13 statuses for every acquisition method. You can create an `in_store_purchase` with status `shipped`, or a `gift` with status `bid`.
- **Fix**: Filter `ORDER_STATUS_OPTIONS` based on the selected acquisition method, using the same pipeline logic as `getValidTransitions` plus the method's initial status.

### H3. `updateOrder` (field edits) records no history or activity
- **Location**: `src/lib/actions/orders.ts:429-488`
- **Problem**: Editing price, carrier, tracking, dates, or notes records no history entry and no activity event. Changes are silently applied.
- **Fix**: Record an activity event (`work.order_updated`) with a summary of changed fields.

### H4. Multiple orders per work — no cross-order status reconciliation
- **Location**: `src/lib/actions/orders.ts:51-87`
- **Problem**: `syncWorkCatalogueStatus` only considers the triggering order's status. If work has two orders and one is cancelled, it doesn't check whether the other order still justifies the current work status.
- **Fix**: Replace single-order logic with a query: find the "highest priority" status across all orders for the work, then derive the correct catalogue status from that. This subsumes fix C1.

### H5. `etaDays!` non-null assertion can crash
- **Location**: `src/app/provenance/provenance-shell.tsx:395`
- **Problem**: `Math.abs(etaDays!)` uses non-null assertion. If `estimatedDeliveryDate` is unset but `hasEta` evaluates true due to optimistic state, this crashes.
- **Fix**: Use `Math.abs(etaDays ?? 0)`.

---

## MEDIUM

### M1. Detail panel timeline hardcoded to online-order flow
- **Location**: `src/app/provenance/provenance-shell.tsx:652-668`
- **Problem**: Timeline always renders "Order placed -> Shipped -> Estimated delivery -> Delivered" regardless of acquisition method. Incorrect for gifts (received), in-store (purchased), and auctions (bid -> won -> ...).
- **Fix**: Derive timeline steps from the order's `acquisitionMethod`, using the same pipeline arrays as `getValidTransitions`.

### M2. `deleteOrder` only guards `delivered`, not `purchased`/`received`
- **Location**: `src/lib/actions/orders.ts:552`
- **Problem**: Only checks `status === "delivered"`. You can delete `purchased` or `received` orders — both are "book in hand" terminal states that should have the same protection.
- **Fix**: Guard against all `BOOK_IN_HAND_STATUSES`.

### M3. Stats `arrivingThisWeek` ignores date-range filter
- **Location**: `src/lib/actions/orders.ts` (getProvenanceStats)
- **Problem**: The `arrivingThisWeek` subquery always computes globally regardless of the `dateRange` parameter passed to the outer function.
- **Fix**: Apply the same date-range filter to the subquery.

### M4. `shippedDate` set on `in_transit` overwrites existing value
- **Location**: `src/lib/actions/orders.ts:506-508`
- **Problem**: If you skip `shipped` and go straight to `in_transit`, `shippedDate` is set to today. If the field was already populated, it gets overwritten.
- **Fix**: Subsumed by C6 — only auto-set when field is currently null.

### M5. Currency hardcoded to EUR in stats display
- **Location**: `src/app/provenance/provenance-shell.tsx:1024`
- **Problem**: `totalSpent` always formatted as EUR regardless of actual currencies. Orders in USD, GBP, etc. are summed and displayed as euros.
- **Fix**: Either show raw number without currency symbol, or track a "primary currency" preference, or show a warning when mixed currencies exist.

### M6. Edit dialog can change `acquisitionMethod` without clearing incompatible fields
- **Location**: `src/app/provenance/order-edit-dialog.tsx:99-115`
- **Problem**: Changing method from `online_order` to `gift` still sends carrier/tracking values. Hidden fields retain state and get persisted.
- **Fix**: Clear method-incompatible fields when acquisition method changes, or null them out before submission if `showShipping` is false.

### M7. No cache tag for orders
- **Location**: `src/lib/cache.ts`
- **Problem**: No `CACHE_TAGS.orders` exists. Order mutations don't trigger cache invalidation. The work detail page can show stale order data.
- **Fix**: Add `orders: "data:orders"` to `CACHE_TAGS`. Invalidate in `createOrder`, `updateOrder`, `updateOrderStatus`, `deleteOrder`.

---

## LOW

### L1. `searchWorksForOrder` vulnerable to SQL pattern injection
- **Location**: `src/lib/actions/orders.ts:569`
- **Problem**: `ilike(works.title, \`%${query}%\`)` — query with `%` or `_` characters matches unintended rows.
- **Fix**: Escape `%` and `_` in the query string before interpolation.

### L2. `order.work.title[0]` crashes on empty title
- **Location**: `src/app/provenance/provenance-shell.tsx:1138`
- **Problem**: Poster fallback uses `order.work.title[0]` which is `undefined` for empty strings.
- **Fix**: Use `order.work.title?.[0] ?? "?"`.

### L3. Edit dialog has no dirty-state tracking
- **Location**: `src/app/provenance/order-edit-dialog.tsx`
- **Problem**: Closing the dialog discards all changes silently, no unsaved-changes warning.
- **Fix**: Track whether any field differs from initial props, warn on close if dirty.

### L4. No pagination on `getOrdersForWork`
- **Location**: `src/lib/actions/orders.ts`
- **Problem**: Returns all orders for a work. A work with many orders loads them all at once.
- **Fix**: Add a limit or pagination parameter. Low priority since most works have 1-2 orders.

---

## Implementation Details

### Shared transition validation (C5)
Extract `getValidTransitions` from `provenance-shell.tsx` into `src/lib/constants/orders.ts` so both client and server can import it. The server action calls it and throws on invalid transitions.

### Multi-order work status derivation (C1, C2, H4)
Replace `syncWorkCatalogueStatus` with a function that:
1. Queries all non-deleted orders for the work
2. Determines the "best" status: if any order is in `BOOK_IN_HAND_STATUSES` -> `accessioned`; else if any order is active (non-terminal) -> `on_order`; else revert to previous status (e.g., `wanted` or `shortlisted`)
3. Records history and activity as before

### Acquisition-aware timeline (M1)
Define timeline step arrays per method:
- `online_order`/`digital_purchase`: placed -> confirmed -> processing -> shipped -> in_transit -> out_for_delivery -> delivered
- `auction`: bid -> won -> shipped -> in_transit -> out_for_delivery -> delivered
- `in_store_purchase`/`event_purchase`: purchased
- `gift`: received

### Auction UI section (C3)
Add `auctionOrders` filter in `ProvenanceShell` for `acquisitionMethod === "auction"`. Render a dedicated "Auctions" section between the pipeline and immediate acquisitions.

## Completion Notes

All 23 issues fixed across 7 files. Typecheck passes clean.

**Files modified:**
- `src/lib/constants/orders.ts` — C4 (removed `won` from terminal), C5 (exported `getValidTransitions`, `getValidInitialStatuses`), added `AUCTION_PIPELINE`, `IMMEDIATE_PIPELINE`, `BOOK_IN_HAND_STATUSES`
- `src/lib/cache.ts` — M7 (added `orders` cache tag)
- `src/lib/actions/orders.ts` — C1/H4 (rewrote `syncWorkCatalogueStatus` to query all orders for multi-order reconciliation), C2 (deleteOrder records history + syncs work status), C5 (server-side transition validation), C6 (auto-dates only when null), H3 (activity event on field edits), M2 (guard all book-in-hand from deletion), M3 (arrivingThisWeek respects date filter), L1 (SQL pattern escape)
- `src/lib/activity/event-config.ts` — Added `work.order_updated` event config + description
- `src/app/provenance/provenance-shell.tsx` — C3 (auction orders section), M1 (method-aware timeline), H5 (etaDays null safety), L2 (title[0] null safety), M5 (currency not hardcoded), imported shared `getValidTransitions`
- `src/app/provenance/order-create-dialog.tsx` — H1 (price "0" preserved), H2 (status options filtered by method with auto-reset), L2 (title null safety)
- `src/app/provenance/order-edit-dialog.tsx` — H1 (price "0" preserved), M6 (clear incompatible fields on method change)

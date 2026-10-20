# Task 1142: A delivered book order brings its copy

**Status**: Completed
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Marking a book order Delivered (or Purchased or Received) changed only the order's status and the book's catalogue status. No copy was created, so a delivered book had no copy at its destination. On 20 October 2026 the live catalogue had 116 delivered orders; 21 had no copy and 5 had only an eBook copy. Films, perfumes and paintings already brought in their holding (SLN-374); books now do the same.

## Implementation Details

- `src/lib/catalogue/book-receipt.ts`: `planBookCopy` picks the edition (the order's, else the book's only edition) and the location (the order's destination, else the location for new copies in Settings). Each case it cannot place is refused with what to set. `bookReceiptQueries` inserts the copy; `bookReturnQueries` deaccessions it on a return.
- `src/lib/actions/orders.ts`: `createOrder` (a shop purchase or a gift) and `updateOrderStatus` write the copy, the order's `instance_id` and `edition_id`, and the status in one write. `bookNotYetReceived` makes a replayed receipt fail. The copy is recorded as `work.instance_added`.
- A returned book order now deaccessions its copy. Task 1134 had left it active; that was correct only while orders made no copy.
- An order created with a new book (`createOrderForNewBook`) is unchanged: the book has no edition yet, so it makes no copy.
- No migration. Docs: `docs/02_DATA_MODEL.md` (`orders`, Book orders) and `docs/05_API_REFERENCE.md` (status route).
- Tests: `order-status-sync.test.ts` (copy at the destination, linked once; shop purchase and gift; Settings location, digital location, three refusals; return), and updated expectations in `publishers.test.ts` and `typed-acquisitions.test.ts`, which had asserted that a receipt makes no copy.

## Completion Notes

The orders already delivered without a copy are repaired separately, with a dry run and Joris's approval.

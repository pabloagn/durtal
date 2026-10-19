# Task 1134: A delivered order's return can be recorded from the book page

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 1133
**Blocks**: None

## Overview

SLN-1507, from the books journey. Deleting a book whose order was Delivered, Purchased or Received is refused until the order is Returned, since that order is the book's acquisition record (SLN-1112). An order with the book in hand is terminal, so the pipeline, where its status changed, leaves it out. Only an order tied to an acquisition target could still be returned, from Hunting for. Any other such order could never be returned, and its book never deleted.

## Implementation Details

- The book page's Orders list (`src/app/(catalogue)/library/[slug]/work-record.tsx`) gives each order with the book in hand a "Record return" text button beside its source (`order-return-button.tsx`), named for its order ("Record return: Delivered order, Shakespeare and Company, Oct 3, 2026"). It calls `updateOrderStatus(id, "returned")`, the same action and transition check as the pipeline, and acts at once with "Return recorded", as Hunting for's Record return and the pipeline do.
- The delete refusal now says where: "Record the order's return under Orders on the book's page before deleting the book." (`keptOrderRefusal` and the delete's own check in `works.ts`).
- No migration.
- Tests: `src/__tests__/ui/order-return-button.test.ts` (offered on delivered, purchased and received orders only, each named for its order; a press returns the order and refreshes the page; a refusal says so and leaves the page). The server path (Returned lifts the refusal, and the book goes with its order) was already covered in `order-status-sync.test.ts`.
- The books journey records the wanted book's return from its page and deletes both books again.

## Completion Notes

Audited on a book with a Delivered order from a long-named bookshop and a Received gift, at 1440, 768, 390 and 320 in Chromium, Firefox and WebKit (alignment, design, overflow, touch: 12 of 12); page weight within budget; the books journey passes.

Returning a book's order changes only its status, as it did from the pipeline: a copy recorded for it stays active. Films, perfumes and paintings have their own order rows; they were not changed here.

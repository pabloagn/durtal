# Task 0970: Delete dialogs say what goes, and a book's acquisition record stays

**Status**: Completed
**Created**: 2026-10-18
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Deleting a book removed its orders and their status history and its acquisition targets with no word in any dialog. The card menu said "all editions, instances, and media", the book page counted editions, copies, readings, quotes and notes, and bulk delete named a fixed list; none named orders or targets. A delivered order can't be deleted on its own, but deleting its book took it silently. A copy's dialog said only "This cannot be undone." (SLN-1112, from the data-integrity survey, items 2 and 6.)

## Implementation Details

- `src/lib/catalogue/delete-summary.ts` (new) counts what deleting books or a copy takes with it, in one query each: editions, copies, readings and sessions, quotes, notes, orders, acquisition targets, images and linked eBooks for books; status history, target links, readings, orders and the eBook for a copy. `keptOrderRefusalFor` finds the first order with the book in hand (Delivered, Purchased or Received, `BOOK_IN_HAND_STATUSES`) and names it by its seller and date.
- `src/lib/catalogue/delete-cascade.ts` (moved from `components/books`): `workDeleteCascadeMessage` adds orders "with their status history", acquisition targets, images and the linked eBooks' return to review, and says "copies", not "instances". `workDeleteCascade` covers loading ("Counting what goes with it…") and a failed read (every kind named, uncounted). `copyDeleteCascadeMessage` and `keptOrderRefusal` are new. `BULK_DELETE_CASCADE` is gone.
- `deleteWork` (`src/lib/actions/works.ts`) refuses a book with an order in hand, as `deleteOrder` does, with an `ExpectedActionError` naming the order; inside its write it locks the book's orders and the book's row and asserts the same, so an order delivered meanwhile still stops it. `getWorkDeleteSummary` and `getCopyDeleteSummary` (`instances.ts`) feed the dialogs.
- `catalogue-ui.ts` / `catalogue-client.ts` add `deleteWork`, so the refusal crosses as data and reaches the screen. The client unwrap now throws `ActionRefusal` (`src/lib/actions/action-refusal.ts`), so a caller can tell a refusal's own words from Next's generic sentence.
- `DeleteConfirmDialog` takes `refusal`: it replaces the description and the warning, and Delete stays off but focusable (`aria-disabled`). `useDeleteSummary` (`src/components/books/use-delete-summary.ts`) reads the counts each time a dialog opens.
- The book page, the card menu and `SelectionToolbar` (new optional `summarize`, used by the library's bulk toolbar) show the same message and refusal; a refused delete's toast shows its reason. The book page no longer sends edition, copy and reading counts to the menu.
- The copy dialog is "Delete copy" and names what goes and what stays.
- `docs/04_ROUTES_AND_VIEWS.md`, Book Detail, says so.

## Completion Notes

- No migration: orders still cascade from their book, and a book whose order has it in hand can't be deleted until the order is marked Returned.
- Tests: `delete-cascade.test.ts` covers every message part, the loading and fallback text, the copy message and the refusal; `order-status-sync.test.ts` deletes a book with a delivered order (refused, through the UI adapter as data, with the seller and date), then returns the order and deletes the book with its order, history and target.

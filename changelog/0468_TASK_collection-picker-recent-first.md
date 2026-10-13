# Task 0468: The collection picker offers the most recently used collection first

**Status**: Completed
**Created**: 2026-10-13
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Joris adds books to collections in bulk, and kept having to find the same
collection again in the "Add to collection" dialog (SLN-570). The dialog now
lists the collection he most recently added to first, then the others he has
added to, newest first, then the rest by name. That holds for single books,
bulk selections, films, perfumes and paintings, on every device. No row is
checked for him.

## Implementation Details

- No new storage: the recency comes from the membership rows themselves.
  `collection_editions.added_at` and `collection_works.added_at` are set by
  the insert that adds a member and never changed. Adding a member that is
  already there inserts nothing (`members.ts`), and an edition re-identified
  keeps its stamp (`identify.ts`). So the latest stamp per collection is its
  last real addition, single or bulk (one statement, one time), and a
  collection created with members counts. A failed or rolled-back write
  leaves no row.
- `getCollectionSelection` (`src/lib/actions/collections.ts`) reads the
  latest stamp per collection in one live query beside its others, then
  orders with `byAddRecency` (`src/lib/collections/recency.ts`): newest
  first, then collections with no member by name (case aside) and id.
  `getCollections` and every other list keep the curated order.
- The dialog reads the order when it opens, so a row never moves under the
  pointer or keyboard focus after a toggle; a collection created in the
  dialog joins the end until the next open, then leads.
- One difference from a separate recency record: removing a collection's
  newest member takes it back to the stamp of its newest remaining one, and
  emptying it puts it with the never-used ones. A removal never moves a
  collection up.
- `docs/06_SERVER_ACTIONS.md`: `getCollectionSelection` and its order.

## Completion Notes

- `collections.test.ts` (PostgreSQL) covers:
  - the order by name before any addition;
  - B then A gives A first, for another book too;
  - a bulk addition is one use;
  - a re-add, a reorder, a rename and a missing edition move nothing, and
    a removal never moves one up;
  - adding back a removed member counts;
  - a whole work (a film) and a new collection made with members count;
  - `getCollections` keeps its curated order.
- `src/__tests__/catalogue/collection-recency.test.ts`: covers the order,
  ties, name order with no history, and that the input is not changed.

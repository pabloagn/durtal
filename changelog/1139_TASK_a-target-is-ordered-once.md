# Task 1139: A target is ordered once

**Status**: Completed
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1119. Order on a book's acquisition target opens `/provenance?target=<id>`,
which opens New order for it. After Create order the address kept `?target=`,
so a reload or Back opened New order again for the target just ordered, and
creating it placed a second order. Nothing on the server refused a second
open order for the same target.

## Implementation Details

- `src/lib/publishers/open-order.ts`: `openTargetOrder(targetId)` finds the
  target's open order (any status but delivered, purchased, received,
  returned or cancelled) and gives its sentence ("This target already has an
  open order, placed 25 September 2026.") and its link,
  `/provenance?order=<id>`.
- `createOrder` (`actions/orders.ts`) refuses an order for a target with an
  open order, with that sentence and link, unless the call passes
  `{ orderAgain: true }`. A replayed request is refused the same way. The
  orders API passes it with `?allowDuplicate=1`, which already allowed a
  second order of the work.
- `getTargetOrderSeed` carries the open order, so New order opened from a
  target warns at once.
- `order-create-dialog.tsx`: once New order opens from a target, the address
  drops `?target=` (`history.replaceState`, so the open dialog stays), and a
  reload or Back shows the board. While the chosen target has an open order,
  the footer says so with Open the existing order and Order again anyway; a
  refusal from the server for a target picked in the dialog shows the same
  notice. A second press of Create order (or ⌘Enter) before the first
  returns does nothing.
- `provenance-shell.tsx`: `?order=<id>` opens that order's panel, then drops
  from the address.

## Completion Notes

No schema change. A database test (`integration/publishers.test.ts`) shows the
seed's open order, a second create refused with the sentence and link, Order
again creating it, and a cancelled order no longer holding the target. A
browser probe in Chromium, Firefox and WebKit creates an order from a target,
reloads, goes Back, reopens the target to see the warning, follows Open the
existing order to its panel, and orders again; the alignment and design audits
run with the warning shown. The database suites ran in CI: the container's
disk is full.

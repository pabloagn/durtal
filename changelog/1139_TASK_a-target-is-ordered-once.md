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
  `{ orderAgain: true }`, so a request replayed after the first order is
  saved is refused. The check is a read before the write, not a constraint:
  two creates sent at the same instant from two tabs can still both land
  (a partial unique index would be a migration). The orders API passes
  `orderAgain` with `?allowDuplicate=1`, which already allowed a second order
  of the work, and answers the refusal with a 409 and the order's link.
  Films, perfumes and paintings (`orderTypedTarget`) are ordered as before:
  a second bottle or sample is a purchase of its own.
- `getTargetOrderSeed` carries the open order, so New order opened from a
  target warns at once.
- `order-create-dialog.tsx`: once New order opens from a target, the address
  drops `?target=` (`history.replaceState`, so the open dialog stays), and a
  reload or Back shows the board. While the chosen target has an open order,
  the footer says so, above its buttons, with Open the existing order and
  Order again anyway, and Create order waits for one of them (its reason
  says so); a refusal from the server for a target picked in the dialog
  shows the same notice. A second press of Create order (or ⌘Enter) before
  the first returns does nothing.
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

Self-review (code-review, high) found the notice splitting the footer's
buttons onto two rows, Create order doing nothing visible while the notice
showed, typed targets that could no longer be ordered twice, the API
answering the refusal with a 500, uneven gaps beside a ghost button, and two
lookups run one after the other; all fixed here. Open the existing order
leaves the dialog without asking about what was typed: the warning shows
when New order opens, before anything is typed, in the common case.

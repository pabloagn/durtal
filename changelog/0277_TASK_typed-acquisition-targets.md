# Task 0277: Acquisition Targets and Orders for Films, Perfumes and Paintings (SLN-374)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: SLN-351, SLN-354, SLN-357, SLN-358, SLN-360
**Blocks**: SLN-379

## Overview
Only books could be wanted and ordered. The database refused a target or an
order for a film, perfume or painting, so a bottle, a film copy or a print
could only be typed in by hand after it came. Now each of the three has
wishes of its own kind and orders for them, and a received order brings in
the bottle, copy or object it names, once. Book targets, orders and totals
work as before, and a museum's custody of a painting stays apart from any
purchase.

## Implementation Details

**Migration** `0063_typed_acquisition_targets` (generated, with a custom part):
- `acquisition_targets` gains typed columns: a perfume's formulation and
  container size, a film's version, optional release, medium and format, a
  painting's object to buy or object to reproduce. FKs RESTRICT;
  `acquisition_target_typed_check` keeps one kind per row, complete. The
  active-target unique index adds them; book identities are unchanged.
- `orders` gains `film_holding_id`, `perfume_bottle_id` and `art_object_id`
  (SET NULL, each unique) and `orders_received_item_check` (at most one
  received item, the book copy included).
- `book_parent_required` on both tables now allows a non-book only when
  typed (`require_target_parent()`, `require_order_parent()`), with the
  0038 message and constraint name otherwise.
- `typed_target_guard`: the formulation, version, release or object belongs
  to the work; a museum's object or one already owned cannot be a target;
  the typed identity is immutable; a harmonization merge may move a target
  before what it names.
- `validate_target_order()`: the 0032 book branch unchanged; a typed order
  has no edition or book copy, its link matches the target, a received one
  has its link, and only a received or returned one has one. Deleting what
  a received order brought in is refused until the order is returned.

**Receipt** (`src/lib/catalogue/acquisition-receipt.ts`, called from
`createOrder` and `updateOrderStatus` in `src/lib/actions/orders.ts`): on
delivered, purchased or received, the same write creates the bottle (target's
formulation, container and size), the film copy (version, release, medium,
format) or the reproduction, or makes the bought object personal (owner label
cleared; whereabouts untouched). The holding takes the order's destination,
shop, price (total, else price) with its currency, and the delivery date. The
destination must suit it (physical, or digital for a digital copy); the
refusal says what to change. The write asserts the order has brought nothing
in yet. A return disposes of the holding ("Returned to the seller", dated).
Both writes now give readable database messages (`withReadableErrors`).

**Services** (`src/lib/actions/acquisitions.ts`): `getTypedTargets`,
`createTypedTarget`, `removeTypedTarget`, `orderTypedTarget`; validation in
`src/lib/validations/acquisitions.ts`; words in
`src/lib/catalogue/acquisition-labels.ts`. `targetState` counts a typed
target received when an order is in hand. `getProvenanceStats({ kind })`
totals one collection.

**Pages**: `WantedSection` (`src/components/catalogue/wanted-section.tsx`) on
the perfume, film and painting pages, with the wish and order dialogs.
Provenance links each order to its own collection (`workHref`), and the order
edit dialog keeps a typed order's target.

**Docs**: 02 (perfume holdings note, `acquisition_targets`, `orders`), 04
(the three pages, Wanted), 14.

## Completion Notes
- Tests: `typed-acquisitions.test.ts` (6): book targets and orders as before,
  and an untyped target or order on another kind still refused with the 0038
  message; a perfume received once (one bottle of the target's formulation,
  size, place and price; a replayed receipt adds nothing; another
  formulation's bottle refused; deleting the bottle refused until the
  return; the return disposes of it and the wish is wanted again); two
  orders of one target (one cancelled, a gift received at once); a film copy
  of the target's version, release and medium in a digital place (a physical
  destination refused); an object in private hands bought without touching
  its loan to a museum, a museum's object refused, a reproduction created;
  a retailer listing implies no order; book totals unchanged and totals kept
  per currency and per kind. `work-kind-migration` and
  `publisher-migration` now expect the new empty columns.
- `pnpm typecheck` clean; `pnpm lint` 0 errors, 81 warnings (main's count);
  `python3 scripts/qa/test-local.py` 151 files: all pass once the two
  migration tests expect the new columns (reran the six affected suites, 50
  of 50).
- Browser, preview from the 2026-10-04 11:37 backup with seeded films,
  perfumes and paintings: in Chrome, a perfume wish bought in a shop made a
  30 ml bottle in Mexico City at €95.00; a film wish (digital, MKV file)
  ordered online and marked delivered on Provenance made the copy; a painting
  wish took a bid. The Wanted parts, the wish and order dialogs and
  Provenance in Chrome, Firefox 157 and Safari 26 at 1440 and 390 px:
  `alignment-audit.js` and `design-audit.js` find nothing in the new parts.
  Known, on main: Safari's dialog bodies collapse (SLN-443, PR #81; with
  that fix the dialogs are clean in Safari), Safari's title-row icons sit
  0.55 px off the 46 px heading, the related-films carousel arrows at 390 px,
  and Provenance's placeholder initial for an order without a picture.
- Review fixes: the merge preview compares active targets on the unique
  index's columns (typed columns included, the size in millilitres), so two
  films or perfumes that want their own versions or formulations merge, and a
  wanted version moves with its open order to the kept film. Deleting a
  formulation, version, release or object deletes the targets removed from the
  Wanted list that have no order; a target still on the list, or one an order
  names, refuses with a message that names the Wanted list (the order first,
  since a wish with an order cannot be removed). Six new cases in
  `typed-acquisitions.test.ts`, including deleting a film, perfume or painting
  that has wishes and orders.
- Browser, preview from the 2026-10-04 22:26 backup (`wanted-seed.sql`, one
  perfume and one painting per browser): in Chrome, Firefox 157 and Safari 26,
  a perfume wish bought in a shop made one 50 ml bottle at €120.00, and a
  painting wish took an auction bid (checked in the database).
  `alignment-audit.js` and `design-audit.js` at 1440 and 390 px find nothing
  in the Wanted parts or dialogs. Known, on main: Safari's title-row icons
  0.55 px off the 46 px heading, and Firefox's carousel arrows at 390 px.

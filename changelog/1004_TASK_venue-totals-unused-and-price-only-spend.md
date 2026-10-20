# Task 1004: Venue totals neither written nor read; Total spent counts price-only orders

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Two tickets on order money, done together:

- **SLN-1307** (findings/data-integrity.md item 9; findings/prices-and-currencies.md item 5). `venues.total_orders`, `total_spent` and `last_order_date` were rewritten only by a Harmonize merge (which also wrote 0 spent for a venue with orders in two currencies, and counted cancelled orders) and read by nothing, so they were stale everywhere. Per the coordinator's ruling the columns stay; this change stops writing and reading them, and a later release drops them (a migration, Joris's word).
- **SLN-1485** (findings/prices-and-currencies.md items 4 and 6). /provenance's Total spent summed `total_cost` only, so an order with a price and no total (from the API, an older row or a hand edit) was left out, though its card shows the price. `avgOrderCost` averaged every currency and status on each load and was never shown.

## Implementation Details

- **Merge** (`src/lib/harmonization/merge.ts`): the venue counter rewrite is gone. The three columns stay in `PROTECTED`, so a merge neither offers nor writes them.
- **Reads:** `WITHOUT_VENUE_TOTALS` (new, `src/lib/catalogue/venue-totals.ts`) leaves them out of `getVenues`, `getVenue`, `getVenueBySlug` and an organization's venues. `createVenue` returns every column but those three.
- **Total spent** (`getProvenanceStats`, `src/lib/actions/orders.ts`): each order counts as `coalesce(total_cost, price)`, the amount its card, receipt and venue page show. Cancelled and returned orders stay out; each currency stays its own line.
- **`avgOrderCost`** is removed from the query, the stats type and the page.
- `docs/02_DATA_MODEL.md`: the three columns are marked unused, with a note on how venue totals are read; Total spent's rule.

## Completion Notes

- **Deviations, on purpose:**
  - Total spent adds the price alone when there is no total, not the price plus shipping that the ticket suggested. Every place that shows an order's amount (the order card, the receipt, the venue page's list) shows the total, else the price; adding shipping here only would make Total spent disagree with them.
  - The interchange export still carries the three columns as stored. Taking them out is a format change (a new version, with a reader for older files that carry them), which belongs with the release that drops the columns.
  - Drizzle names every schema column in an insert, so `createVenue` still names them (with `default`). The release that removes them from the schema is therefore the one that drops them; a rollback past it would break creating a venue, not reading one.
  - Zero-decimal currencies (the ticket's optional item 3) are left as they are.
- **Tests (DB, private PostgreSQL 16):**
  - `provenance-stats`: a price-only delivered order counts in Total spent, a cancelled one does not, each currency is its own line, and `avgOrderCost` is gone.
  - `venues-retailers`: a venue merge offers none of the three columns and leaves stored values untouched; `getVenue` and `createVenue` return neither.
- **Rechecked on main after #611:** `pnpm typecheck` and `pnpm lint` clean, `pnpm test:local` 8,765 of 8,765, `pnpm build`; the browser audit passes 18 of 18 page loads on /provenance, /places and /organizations in Chromium, Firefox and WebKit at 1440 and 390; `page-weight.js` passes.

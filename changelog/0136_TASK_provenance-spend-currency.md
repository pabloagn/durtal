# Task 0136: Provenance "Total Spent" per currency

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0086
**Blocks**: None

## Overview

SLN-323: The "Total Spent" card on `/provenance` showed a bare number with a dollar icon. `getProvenanceStats` added EUR and GBP amounts together and counted cancelled orders. Order cards formatted a missing currency as USD. Both order dialogs allowed an empty currency, and the server accepted any text.

Live data at the time (read-only check): EUR 285.46 on 21 orders, GBP 13.51 on 1 order, 19.13 on 1 cancelled order with no currency. The card showed 318.10.

## Implementation Details

- `getProvenanceStats` (`src/lib/actions/orders.ts`) returns `spentByCurrency`: one total per currency, excluding `UNSPENT_STATUSES` (`cancelled`, `returned`). The mixed `totalSpent` sum is removed.
- `src/lib/utils/money.ts`: `formatMoney` formats an amount in its own currency and never assumes one; `sortCurrencyTotals` puts EUR first, then larger totals, then orders without a currency.
- The card shows the main total (for example `€285.46`) with other currencies below (`+ £13.51 · all time`). The icon is now a wallet.
- Order dialogs: the currency selector comes first and has no empty option. Price and Shipping labels show the symbol (`Price (€)`). Orders saved without a currency get the last-used one (default EUR) when edited. The preference helpers tolerate blocked storage.
- `orderCurrencySchema` accepts only supported ISO 4217 codes (or null). `createOrder` and `updateOrder` both enforce it.
- No schema change. No live data change. The cancelled order without a currency keeps its null value.

## Completion Notes

- 18 unit tests (formatting, ordering, preference, validation) and 4 PostgreSQL tests on a disposable database (per-currency totals, cancelled/returned exclusion, rejected codes write nothing).
- Browser check on a disposable preview seeded with the same amounts: the card shows `€285.46` and `+ £13.51 · all time`; the edit dialog lists exactly 22 currencies and relabels Price/Shipping on change.

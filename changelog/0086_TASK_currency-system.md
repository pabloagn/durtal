# Task 0086: Currency System with Defaults & Enum

**Status**: Completed
**Created**: 2026-04-01
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0060
**Blocks**: None

## Overview
Currency is currently stored as a free-text field on orders with no validation, no default, and no way to know what currencies are actually in use. A bare number with a text code is meaningless without structure. Add a proper currency system: a Postgres enum (or reference table) of supported ISO 4217 currencies, a default currency preference (EUR), and proper formatting/display throughout the provenance pipeline.

## Requirements

### Currency Enum
- Create a `currency` Postgres enum with common ISO 4217 codes:
  - `EUR`, `USD`, `GBP`, `CHF`, `JPY`, `PLN`, `CZK`, `SEK`, `NOK`, `DKK`, `CAD`, `AUD`, `BRL`, `MXN`, `ARS`, `CLP`, `CNY`, `KRW`, `INR`, `TRY`, `RUB`, `ZAR`
- Use this enum on the `orders.currency` column (migration to convert existing text values)
- Also apply to `instances.acquisitionCurrency` if it exists as free text

### Default Currency
- Default to `EUR` on the order create dialog (pre-selected in the currency dropdown)
- Store user's preferred default currency in `localStorage` -- if the user changes it during order creation, remember the choice for next time
- The currency dropdown should show the symbol + code (e.g., "EUR", "USD $", "GBP", etc.)

### Currency Display & Formatting
- Use `Intl.NumberFormat` with the stored currency code for all monetary displays
- Stats dashboard (total spent, avg cost): aggregate per currency, show breakdown if multiple currencies exist (e.g., "Total: 1,245.00 EUR | 320.00 USD")
- Order cards in kanban: show formatted price with currency symbol
- Detail panel: full price breakdown with currency

### Migration
- Convert existing `currency` text column to enum
- Backfill existing orders: any null currency -> 'EUR', any valid ISO code -> map to enum value
- Update `docs/02_DATA_MODEL.md` with the new enum

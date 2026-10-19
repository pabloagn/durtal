# Task 1070: Copies on a book: one price format, a currency choice, "No copy held", former copies last

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1127, from findings 8, 9, 10 and 15 of
`findings/copies-locations-survey-2026-10-18.md`, with item 6 of the
dates-numbers survey and section 3 of the dead-code survey.

- A book copy bought for 1,450 euros read "EUR 1450", and its currency field
  took any three letters.
- The Magic Mountain's only copy is deaccessioned, but its page said
  "Accessioned" with nothing saying no copy is held.
- A sold copy sat among the held ones, and the heading counted it.

Item 4 (an Undo after deleting a copy) is left out: deleting a record keeps
its confirm and gets no Undo, by the coordinator's rule of 18 October.

## Implementation Details

1. **One price format** (`formatMoney`, `src/lib/utils/money.ts`):
   - It uses `Intl.NumberFormat("en", { style: "currency" })`: "€1,450.00",
     "€18.50", "¥9,800".
   - A code that isn't ISO 4217 shows before the grouped number ("XX
     1,450.00"). With no currency, the number shows alone, grouped.
   - Book copies, films, perfumes, paintings, retailers, venues, acquisition
     targets and provenance all use it. The two `formatPrice` helpers
     (`utils/format.ts` and `catalogue/perfume-labels.ts`) are gone.
2. **The currency is a choice** on a book copy's acquisition and disposition
   (`currencyOptions`, `src/lib/constants/currencies.ts`):
   - It lists the home currency first, then the rest in their usual order.
   - A stored code that isn't on the list stays offered, so editing a copy
     never drops it.
   - Typing a price with no currency chosen picks the home currency, as a
     new order does. "None" clears it.
3. **"No copy held"** (`holdsNoCopy`, `src/lib/utils/ownership.ts`):
   - An accessioned book whose copies are all deaccessioned (or that has
     none) shows "No copy held" beside its status in the header, and
     "Accessioned · No copy held" in the record.
   - Deaccessioning the book's last held copy says "Copy updated. No copy
     of this book is held now." The toast offers "Deaccession the book" for
     10 seconds.
4. **Former copies** (`edition-detail-card.tsx`):
   - Held copies come first, with Available before the other statuses, in
     entry order within each.
   - Deaccessioned copies follow under "Former copies (N)", keeping Edit and
     Delete.
   - The "Copies" heading counts held copies only. An edition with only
     former copies says "No copy held" under it.

## Completion Notes

- **Tests**:
  - `utils/money`: grouping, decimals, a currency without decimals, codes
    that aren't ISO 4217, no currency, and the currency options.
  - `utils/ownership`: held copies across editions and when "No copy held"
    shows.
  - `catalogue/perfume-home` now checks prices through `formatMoney`.

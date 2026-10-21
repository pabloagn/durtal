# Task 1144: Order entry, shared shipping and permanent notification history

**Status**: In review
**Created**: 2026-10-21
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Joris's provenance tickets of 17 October 2026:

- SLN-983: on New order's Method step the hunt and edition fields sat below the step's 260px minimum height, so a short step left a band of dead space under Initial status.
- SLN-985, SLN-987: "Venue / Seller" was free text, and the save never sent it. No order made in the dialog had a shop, so the order card and panel never showed one.
- SLN-986: Edit order had no shop field at all.
- SLN-989: "Acquisition target" and "Ordered edition" read as the same thing, and a hunt for one edition showed that edition in both lists.
- SLN-984: multiple books can share an order and its shipping charge.
- SLN-988: order search finds close title and author misspellings.
- SLN-991–994: book links in status notifications, the existing understated close control, and all completed notifications kept until explicitly removed.
- SLN-995: remove standing helper notes and redundant subtitles across the affected app surfaces.

## Implementation Details

- `src/app/(catalogue)/provenance/order-create-steps.tsx`: `OrderShopField` picks the shop from the places (`searchVenues`), with Create for a shop not there yet (`createVenue`, typed by the order's method: an online store, an auction house, a bookshop, a fair). It is stacked like the form's other fields: the label over the chip or Choose, Choose pulled out by its padding onto the label's edge. The free text `venueName` is gone from the details form.
- `order-create-dialog.tsx`: sends `venueId` (none for a gift, whose origin is its giver); a picked shop counts as unsaved work. The hunt and edition fields render inside the Method step, under Initial status, so the step's minimum height includes them.
- `order-edit-dialog.tsx`: the same shop field, seeded from the order's venue, saved as `venueId`, and marked unsaved when changed.
- `src/components/publishers/order-target-fields.tsx`: the hunt list is "Hunting for", the name of the book page's section, shown only when the book has a hunt, with "Any <publisher> edition" for a publisher hunt and "Not for a hunt" for none. The edition list is "Edition" ("Not known yet"), hidden when the chosen hunt is for one edition, since the hunt already names it.
- The initial shop fix uses the existing `venueId` fields. Migration `0091_order_groups` adds shared order metadata and shipping, with an optional group link on each book's order. Existing orders remain standalone and unchanged. Each book retains its own price, receipt and status history; shared metadata is kept consistent by database triggers. Spending counts shipping once and order counts count the group once.
- Group creation writes all items atomically. The same edit dialog updates the group's seller, date, reference, currency and shipping while keeping book prices separate. The group detail lists its books and individual statuses.
- `searchWorksForOrder` uses the existing normalized, typo-tolerant title/author search while preserving edition and ISBN matches.
- Notification storage now records success, info, warning and error results, including safe same-app book links. It no longer expires after 14 days or drops entries after 50. Dismissing a toast does not remove its inbox entry. Storage remains local to the browser.
- Removed the author-image monochrome note, Add-page and Statistics subtitles, reader zoom note, and redundant eBook instructions. Kept field labels, errors, settings explanations and empty-state purpose text.
- Tests: `src/__tests__/provenance/order-shop-and-hunt.test.ts` (Edit order shows and saves the shop, clears it, has none for a gift; the hunt and edition fields in their three cases). `scripts/qa/journeys.mjs` picks "Edition" in the hunt journey.

## Completion Notes

The owner approved implementing and testing migration 0091 on disposable local data only; it has not been applied to the live database.

SLN-990 was completed separately after explicit approval: only the seller of the five named orders was changed to the existing Amazon.nl venue. All other fields were verified unchanged.

Validation: type checking passed; lint passed with no errors (85 warnings). The full local suite covered 871 test files and exposed three stale expectations; all three affected files passed on the focused rerun (14 tests), including populated migration preservation. The focused notification and order-dialog run passed 57 tests. Production build passed. Chromium, Firefox and WebKit passed the order creation/editing, shared shipping, linked notification and inbox persistence flow, plus 96 alignment/overflow/accessibility checks across desktop, 390px and 320px layouts. Page weight passed all 39 applicable routes; nine fixture-dependent routes were skipped because the synthetic catalogue had no corresponding records.

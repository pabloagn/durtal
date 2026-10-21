# Task 1144: An order's shop is a place, and its hunt and edition read apart

**Status**: Completed
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

## Implementation Details

- `src/app/(catalogue)/provenance/order-create-steps.tsx`: `OrderShopField` picks the shop from the places (`searchVenues`), with Create for a shop not there yet (`createVenue`, typed by the order's method: an online store, an auction house, a bookshop, a fair). It is stacked like the form's other fields: the label over the chip or Choose, Choose pulled out by its padding onto the label's edge. The free text `venueName` is gone from the details form.
- `order-create-dialog.tsx`: sends `venueId` (none for a gift, whose origin is its giver); a picked shop counts as unsaved work. The hunt and edition fields render inside the Method step, under Initial status, so the step's minimum height includes them.
- `order-edit-dialog.tsx`: the same shop field, seeded from the order's venue, saved as `venueId`, and marked unsaved when changed.
- `src/components/publishers/order-target-fields.tsx`: the hunt list is "Hunting for", the name of the book page's section, shown only when the book has a hunt, with "Any <publisher> edition" for a publisher hunt and "Not for a hunt" for none. The edition list is "Edition" ("Not known yet"), hidden when the chosen hunt is for one edition, since the hunt already names it.
- No server change: `createOrder`, `createOrderForNewBook` and `updateOrder` already took `venueId`. No migration.
- Tests: `src/__tests__/provenance/order-shop-and-hunt.test.ts` (Edit order shows and saves the shop, clears it, has none for a gift; the hunt and edition fields in their three cases). `scripts/qa/journeys.mjs` picks "Edition" in the hunt journey.

## Completion Notes

Orders made before this have no shop; SLN-990 sets Amazon.nl on Joris's five placed orders, which needs the live database.

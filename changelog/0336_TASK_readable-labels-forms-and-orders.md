# Task 0336: Readable labels in the copy and edition forms and on orders

**Status**: Completed
**Created**: 2026-10-05
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-400 (tasks of PRs #35 and #71)
**Blocks**: None

## Overview

SLN-400 was closed with stored values still shown as text in a few places
the book, place and order pages lead to: the copy form's selects ("very
good", "lent out", "in store purchase"), the edition form's binding and role
selects and its metadata source ("isbndb"), a sold copy's disposition
("sold"), and every order status on the provenance pages ("in transit").
This task gives them the app's words.

## Implementation Details

- `src/lib/constants/orders.ts`: `ORDER_STATUS_LABELS` and
  `ACQUISITION_METHOD_LABELS` move here from
  `src/lib/catalogue/acquisition-labels.ts` (which re-exports them), typed by
  status and method, with `orderStatusLabel()` and `acquisitionMethodLabel()`
  (an unknown value falls back to `enumLabel`).
- Provenance list, order panel (status line and its toast), the provenance
  page's orders, the place page's orders (its own `statusText` copy is gone)
  and the book record's orders use them: "Bid placed", not "Bid".
- Copy form: format and condition from `COPY_FORMAT_LABELS` and
  `COPY_CONDITION_LABELS`; status, disposition and acquisition type through
  `enumLabel`. Edition form: binding and contributor role through
  `enumLabel`, the source through `metadataSourceLabel`. A copy's
  disposition on the book page through `enumLabel`.
- `COPY_FORMAT_LABELS.ebook` is "E-book", as every other list says it.

## Completion Notes

- `src/__tests__/utils/labels.test.ts`: order statuses and methods, and the
  copy labels equal to `enumLabel`'s.
- `src/__tests__/ui/copy-form-labels.test.ts`: the copy form's format,
  condition, status and disposition selects list words, no stored key.

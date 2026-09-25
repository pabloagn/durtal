# Task 0124: Rare cover indicator and bulk actions

**Status**: Completed
**Created**: 2026-09-25
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0123
**Blocks**: None

## Overview

SLN-315 follow-up: match the rare cover icon to adjacent cover indicators and support bulk marking and unmarking.

## Implementation Details

- Cover-only badge style matches the priority indicator's translucent black background, border, blur, radius and responsive dimensions. List/table indicators stay unchanged.
- Bulk toolbar Rare menu provides Mark as rare and Unmark rare without a form.
- Validated bulk action performs one atomic UPDATE for the selected IDs. Marking dates newly marked books to browser-local today and preserves already-marked dates; unmarking clears the paired date.
- Records activity for changed books and refreshes the library. No database migration required.

## Completion Notes

Typecheck, lint and nine local PostgreSQL integration tests pass. Browser tested both bulk actions against three synthetic books, including preservation of existing dates. Computed styles confirm cover rarity and priority indicators match. No real books were changed during verification.

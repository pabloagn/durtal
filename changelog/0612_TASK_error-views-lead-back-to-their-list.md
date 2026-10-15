# Task 0612: Error views lead back to their own list

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

From the loading, empty and error states audit of 15 October
(`findings/audit-loading-2026-10-15.md`, finding 8). With the database
failing, these pages could only offer "Go to the dashboard":
- a publisher;
- an eBook;
- a collection;
- the review queue;
- a reading page.

The books, a book, people and a person already lead back to their own list.

## Implementation Details

- **`ListSectionError`** (`src/components/shared/section-error.tsx`) is the
  error view of a section with a list:
  - On the list itself, it says the list could not be loaded and leads to the
    dashboard.
  - On any page under the list, it leads back to the list.
  - On one record (one part after the list's address that is not one of the
    section's own pages), it names the record.
- It is the error view (`error.tsx`) of:
  - publishers, whose own pages are `new` and `review`;
  - eBooks, whose own pages are `highlights`, `review`, `runs`, `upload` and
    `offline`;
  - collections;
  - reading, which has no records.

## Completion Notes

- `src/__tests__/ui/loading-audit-states.test.ts`: for each of the four, on
  the list, a record and a page of its own, the link, its words and the
  description.
- Production preview with every database query failing, in Chromium,
  Firefox and WebKit at 1440, 390 and 320:
  - The pages were the publishers, a publisher, an eBook, the review queue,
    the collections and the journal.
  - Each shows its error view with Try again and its way back.
  - The alignment, touch, design and layout audits report nothing.

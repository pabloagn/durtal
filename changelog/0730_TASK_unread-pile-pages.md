# Task 0730: The unread pile counts pages only where there are some

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-802. Reading, Stats, The unread pile said "2 books you own and have not
read, 0 pages" and, two lines lower, "2 without a page count". The line now
leaves the pages out when no book in the pile has a page count, and names
which books the pages cover when only some have one. Design-polish pass
three, item 5 (findings/design-polish-3-2026-10-15.md).

## Implementation Details

- `src/lib/reading/charts.ts`: `unreadPileText` writes the line:
  - no page counts: "2 books you own and have not read."
  - some: "12 books you own and have not read, 3,420 pages in the 10 with a
    page count: at your pace…, about 1.5 years to read those."
  - all: as before, "…, 1,200 pages: at your pace…, about 2 years to read
    them all."
  The time to read them shows only with pages to count, so it never reads
  "about 0 days".
- `src/app/(catalogue)/reading/(tabs)/stats/page.tsx` uses it. The footnote
  "N without a page count." stays.
- Test: `src/__tests__/reading/unread-pile-text.test.ts`.

## Completion Notes

See the PR for the browser checks.

# Task 0824: Counts agree across pages

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-886, from the counts survey (findings/counts-survey-2026-10-16.md). The
same thing was counted differently on different pages: perfume notes counted
zero perfumes, Settings counted every organization as a publisher, "owned"
meant any book with a copy in some places and an accessioned book with a copy
in others, and pages named the same things with different words.

## Implementation Details

- **Owned.** `ownedWorkCondition` (`src/lib/catalogue/holdings.ts`) is the
  rule from CLAUDE.md and docs/02: accessioned and at least one copy that is
  not deaccessioned. The library's Owned filter, Reading (stats, queue,
  suggestions, actions), Statistics and the series list and page use it.
  `ownedBookCondition` (a copy alone) stays for the page rule and enrichment.
  The series list says "N owned" instead of "N accessioned", and the series
  page marks each owned book.
- **Perfume notes.** `linkRows` (`src/lib/catalogue/taxonomy-storage.ts`)
  lists every link of a family's items, including perfume notes, variant
  notes and variant taxa. The family list counts and the item page use it; a
  family that does not apply to books counts its own kinds (`itemKinds`), and
  its item page links each kind to that kind's filtered list.
- **Publishers.** Settings, Data counts publishers through
  `publisherCondition`, as the Publishers page does. A publisher's page counts
  an edition as owned only when its book is accessioned (review fix).
- **Names.** The dashboard says Copies (not Instances) and Authors;
  Statistics says "Owned copies" (the copies of owned books, fewer than the
  dashboard's Copies) and "Authors' countries", and explains what a book you
  own is;
  Places says places (not venues); a location's count names book copies as
  copies and one other kind by its name; a collection's pager uses the noun
  of its count line.
- Book views stay book-only (SLN-419), so the dashboard's Authors under Books
  counts book authors.

## Completion Notes

- Database suites updated: test books are accessioned, and Statistics and the
  Owned filter each gain a tracked book with a copy that is not counted.
- Unit tests for `locationItemCount` and `collectionMembersNoun`.
- On the 15 Oct backup, 61 books lose "owned" (57 wanted, 3 on order, 1
  tracked): 237 under the old rule, 176 under the new.
- Audits clean on the dashboard, Statistics, Settings Data, series, a
  collection, Places, Locations and the perfume notes pages in Chromium,
  Firefox and WebKit at 1440, 390 and 320; page weight passes.


## Recovery review — 16 October 2026

- Integrated current main without rewriting the original branch.
- Corrected the reading picker and Up next fixtures: intended owned books are explicitly accessioned; an accessioned book with only a deaccessioned copy remains unowned.
- Added regressions for tracked, wanted and on-order books with active copies in both query paths. Ownership still requires both accessioned status and an active copy.
- The home page's Authors figure remains explicitly under Books, consistent with SLN-419's book-credit scope; it does not present that number as the global People total.
- The owner authorized resolving and merging this PR on 16 October. The historical 237→176 example is a query-semantic change, not authorization to alter stored catalogue statuses. No live data was changed.

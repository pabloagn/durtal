# Task 0829: Series and collection counts add up

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-915, from the series and collections survey
(findings/series-collections-survey-2026-10-16.md, item 4). A collection
holding five books, four of them through six editions, read "1 book · 6
editions · 2 films · 1 perfume · 1 of 5 books read". A series holding more
books than its total read "5 books of 4", "5 of 3 owned" and "Read 2 of 3".

## Implementation Details

- **Collections** (`src/lib/collections/counts.ts`): the count line counts a
  book once, held whole or through its editions, and says when its editions
  outnumber the books they hold: "5 books (6 editions) · 2 films · 1 perfume".
  The read ratio already counted books once, so it now matches the line. The
  pager names one card each: "books" when each card is a book of its own,
  "editions" when every card is an edition, a kind's name when all cards are
  of it, else "items".
- **Series** (`src/lib/series/counts.ts`): "N books of T" only when the books
  fit in the total; "owned" and "read" count against the total or, when there
  are more books, the books. Used on the series card and page.
- docs/03, Cards, describes both counts.

## Completion Notes

- Unit tests for the Decadents case, a book held through two editions, the
  pager's nouns and a series over its total.
- On a Decadents-like collection the card, header and pager read "5 books (6
  editions) · 2 films · 1 perfume", "2 of 5 books read" and "10 items" (ten
  cards); an Overfull-like series reads "5 books", "0 of 5 owned", "Read 2 of
  5".
- Audits clean on /series, a series page, /collections and a collection page
  in Chromium, Firefox and WebKit at 1440, 390 and 320; page weight passes.

# Task 0306: Reading across the library, cards and catalogue pages

**Status**: Completed
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0302 (SLN-444), 0303 (SLN-446), 0304 (SLN-447), 0305 (SLN-448)
**Blocks**: Reading tracker steps 6 to 15 (SLN-442)

## Overview

Step 5 of 15 of the reading tracker (SLN-442, sub-issue SLN-449). Reading
shows wherever books are listed: the library filters to "unread books I own"
(`/library?reading=unread&holding=owned`), "read in 2025", re-reads or
"currently reading", sorts by last read, and shows progress on cards; the
author, series, collection, publisher and recommender pages say how many
books are read; `GET /api/works` answers the same questions. No migration.

## Implementation Details

- One parser, `parseReadingFilters` (`src/lib/reading/filter-params.ts`):
  `reading`, `readFrom`, `readTo`, `reread`, `holding`, `status` and `sort`
  for the page and the API. It returns the valid filters and the zod issues:
  the page drops what is not valid (`status=owned` never reaches the enum's
  SQL), the route answers 400. `readingFiltersSchema` checks the same filters
  when the timeline sends them back.
- Conditions: `readingFilterConditions` (`src/lib/reading/filter-conditions.ts`)
  in `buildWorkConditions` and `getWorksForTimeline`: the reading state
  (`readingStateSql`), Holding (`ownedBookCondition`; both values or neither is
  no filter), Read in (`readInCondition`, new in `summary.ts`: a finished
  reading's year at any precision), Re-read (two finished readings), and the
  status checked against `catalogueStatusEnum`.
- Sort "Last read": `lastReadAtSql`, now the later of the last progress and
  the last finish date (a past read or an import has no progress), never-read
  books last.
- One query: root `extras` on `getWorks` and `getLibraryStats` (state,
  percent as a number, times read, last finish and its precision);
  `workCardExtras` / `workReadingExtras` (`src/lib/actions/utils/work-card-query.ts`)
  are functions of the work's columns, so nested `work` relations (author,
  recommender, series) take them too.
- Cards: `reading?: { state, percent }` on every card item type; `CardReading`
  (`card-status.tsx`) takes the status slot while a reading is open ("Reading
  44%", "Paused 44%"), its tooltip the status's plus the reading
  (`src/lib/reading/card.ts`). Every card mapper passes it (library page,
  dashboard, carousels, author, recommender, taxonomy, publisher books).
- List badge and table columns (Reading, Last read, Times read, Progress) from
  `getReadingSummaries`, loaded only while the list or table shows. The new
  columns join a saved column choice hidden (`withNewColumns` already merged
  new columns; the four are hidden by default). The table keeps the server's
  order (`preserveOrder`).
- `GET /api/works`: the reading parameters, `sort=lastRead`, 400 with the
  issues, `total` with the filters, and `reading` on each work.
- Author: "Read 7 of 12", All / Unread / Reading / Read (`?reading=`), and a
  Reading record group (read, re-read books, your average of the books'
  ratings, last read). Series: "Read 4 of 20", "Next to read" from
  `nextToRead` with the copy's whereabouts (`getSeriesNextToRead`), each
  volume's badge, "· 4 read" on series cards. Collection: "· 12 of 30 books
  read" and the state on members' note lines (`readingStatesFor`). Publisher:
  "Read" in "In the catalogue". Recommender: "You have read 7 of their 15
  picks".
- Filters panel: Reading, Holding, Re-read and a "Read in" year range
  (`getReadYearRange`); "Last read" in the sorts; `domainSwitchHref` keeps the
  reading parameters on books and `holding` for films.
- Docs 04 (the `/library` section rewritten to the real filters and sorts, the
  other pages), 05 (`GET /api/works`) and 06.

## Completion Notes

RESULTS

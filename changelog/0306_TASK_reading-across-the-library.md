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

- Tests: unit `library-rules.test.ts` (the parser with every parameter, bad
  values, both holding values, reversed years, `status=owned` and
  `status=bogus` dropped; the card's label and tooltip; the list badge; the
  author and series record; the author tabs; `domainSwitchHref` for books and
  films; the four columns joining a saved choice hidden; every card mapper
  passing `reading`); component `card-reading.test.ts`; database suite
  `reading-library.test.ts` (each filter alone and with `holding=owned`,
  holding with a deaccessioned copy, read in at day, month and year
  precision, re-read, the Last read sort with never-read last, the minimum
  rating and the Rating sort on the book's rating, the extras as numbers,
  the timeline's filters, `getReadingSummaries`, an author's counts and
  average with a book being re-read, a series' next to read across a gap, an
  abandoned volume and a lent copy, and `GET /api/works` with each parameter,
  400s and `total`); `publisher-books.test.ts` reads the new Read count.
- `pnpm typecheck` clean; `pnpm deadcode` clean; `pnpm lint` 0 errors, 81
  warnings, none in the new files; `python3 scripts/qa/test-local.py`: 184
  files, 2042 tests, 0 failed.
- Page weight on a preview of `live-before-0064-0065-20261005-013641.dump`
  with readings, before (main at 79d3d4f, `/library` already under budget
  after task 0324) and after: `/library` 294 KB to 295 KB (under 2 KB for the
  card change), `/` 269 KB to 270 KB, `/library/new` 41 KB both, every other
  route the same and within budget.
- Browsers, Chrome, Firefox 157 and Safari 26 at 1440, 768 and 390 px: the
  grid at 2, 4 and 8 columns (CardReading fits at 171 px with the rating,
  no row overflows), the list with its badges, the table with the four new
  columns and the server's Last read order, the filter panel open with
  Reading, Holding, Re-read and Read in, `/library?reading=unread&holding=owned`,
  an author ("Read 1 of 4"), a series ("Read 2 of 6", "Next to read: 3.
  Boyhood Island · Not owned · On Order"), a collection ("1 of 14 books
  read"), a publisher (Read 5), a recommender ("You have read 4 of their 99
  picks") and the dashboard. Fixed on the way: a series row's reading badge
  pushed the row 35 px past the screen at 390 px (it moves to the author line
  under `sm`). Left as they were before this change, and filed: the series
  rows' titles have no room at 390 px, and the table's copy button sits
  10 px off its title when a badge is under the title; also Safari's
  0.55 px title-row icons and the decorative monogram initials.
- Touch (Chrome, 390 px, coarse pointer): CardReading fits in a 138 px info
  row beside the rating, no page overflow. After rebasing on main at 108f59b:
  typecheck clean, 184 files, 2042 tests, 0 failed; the series row and the
  two-column grid rechecked at 390 px in all three browsers.
- Journey: `node scripts/qa/journeys.mjs --disposable <preview> reading`
  passes every earlier step, then `/library?q=journey&reading=unread&holding=owned`
  lists Journey Sequel and not Journey Reading, and "read in" this year lists
  Journey Reading and not Journey Sequel.
- Not run: the iOS Simulator and VoiceOver by hand.

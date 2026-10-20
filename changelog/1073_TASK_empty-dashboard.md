# Task 1073: An empty catalogue's dashboard is one state, Statistics says what it counts, and Authors counts writers

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1184, from items 4 and 9 of `findings/empty-library-survey-2026-10-18.md`,
with item 7 of the dashboard survey (empty Statistics had no purpose sentence).

- With nothing catalogued, the dashboard showed ten figures, all "0", one Add
  book and "No books on your shelves yet." The only way to a first film,
  perfume or painting was the small group headers.
- After adding a person with no works, the dashboard's Books group said
  Authors 2 while Statistics said 1.

## Implementation Details

- **The empty dashboard** (`src/components/domains/empty-catalogue.tsx`):
  - When no open collection has a record (`catalogueIsEmpty`,
    `src/lib/catalogue/domain-homes.ts`), the index and the sections give way
    to one state: "Nothing catalogued yet", a sentence on what the library is
    for, Add book, and "Or add a perfume, a film or a painting." with a link
    to each open collection's new page.
  - The check runs in the dashboard's first round trip, beside the other
    reads. The header's Add book gives way to the state's own, so the page
    has one Add.
  - From the first record of any kind, the index shows as before.
- **Statistics before a book is owned** (`NoOwnedBooks`,
  `src/components/statistics/no-owned-books.tsx`):
  - The dashboard's Statistics and `/statistics` show the same state, with a
    sentence saying the numbers count the books you own, those with a copy
    in one of your locations.
  - `/statistics` carries Add book. The dashboard doesn't, as its header has
    one.
  - Both views take their number tiles from `libraryTile`
    (`src/lib/statistics/tiles.ts`), so a figure and the "No page counts yet"
    dash read the same in both.
- **Authors** (`libraryStatsReads`, `src/lib/actions/utils/library-stats.ts`)
  counts the people credited as author or co-author on a book, as Statistics
  does. A person with no book, or only a translator's credit, isn't counted.

## Completion Notes

- **Browsers.** Checked on a private preview in Chromium, Firefox and WebKit
  at 1440, 390 and 320 (touch at 390 and 320):
  - Empty: the dashboard shows the one state with Add book and three links,
    no index and no rail. `/statistics` shows its state with Add book.
  - One film and a book person with no works: the index shows Films 1 and
    Authors 0, and Statistics says what it counts, with one Add book on the
    page.
  - One wanted book: Books 1 and Authors 1, with Recent additions, Wanted and
    Recent people.
- **Audits.** The browser audit passes 63 of 63 loads: `/` and
  `/statistics` empty, with one film, and on the large seed; `/` with one
  book. Page weight passes every route (the dashboard is 259 / 300 KB on the
  large seed).
- **Tests**:
  - `ui/empty-dashboard`: the state's heading, sentence and links for every
    set of open collections, its place in the page, and the Statistics state
    and tiles.
  - `integration/domain-homes`: Authors leaves out a book person with no
    book and a translator and counts a co-author; the catalogue is empty
    until any collection has a record.
  - `statistics/pages-tile-and-origins-title` follows the shared tiles.

### Review on current main (2026-10-20)

- Main had since given `/statistics` its own empty state, with the reading
  and other collections' sections below it (#588, SLN-1174).
  `NoOwnedBooks` takes its place there and keeps those sections, its
  plainer sentence ("These numbers count the books you own: those with a
  copy in one of your locations.") and its 40px Add book. The dashboard's
  Statistics shows the same state without the Add.
- The dashboard reads `numbers`, `written`, `breakdown` and the busiest year
  in one statement (task 1005); the empty check rides beside it, so the page
  stays two round trips.
- **Browsers.** On a private preview emptied of books, editions and copies,
  `/` shows "Nothing catalogued yet" with one visible Add book in Chromium,
  Firefox and WebKit (the header's Add gives way once the check is in), and
  `/statistics` its own state with one Add book. The browser audit passes 18
  of 18 loads of `/` and `/statistics` empty, and 18 of 18 on the seeded
  preview.
- **Checks on main after #618:** `pnpm typecheck` and `pnpm lint` clean,
  `pnpm test:local` and `pnpm build` pass. `page-weight.js` passes.

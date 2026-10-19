# Task 1002: Lists load only their page

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-938, from the scale survey (findings/scale-pages-survey-2026-10-16.md, row 8) and the query and index survey (item 1.6). A Drizzle relational list (`findMany` with `with`, `orderBy` and `limit`) turns each relation into a lateral join, and PostgreSQL runs every one of them for every matching row before the sort and the limit. `/library` sorted by rating or year built the authors, editions, copies, artwork and reading figures of all 5,000 books to keep 48. /people did the same for every person. The survey's third list, /collections and the dashboard loading every member row to count them, was fixed on main first: they count in SQL since SLN-1058 (#580) and SLN-1059 (#589).

## Implementation Details

- **Library** (`getWorksWith`, `src/lib/actions/works.ts`): every sort that does not already pick its ids in JavaScript (rating, year, recently added, last read, Up next) selects the page's ids in a subquery, `works.id in (select id … order by … limit … offset …)`, inside the same query. The cards then load for those ids only, in the same order with ties by id. Title and author sorts are unchanged.
- **People** (`getAuthors`, `src/lib/actions/authors.ts`): the same subquery for every sort except "works", which already picked its ids.
- **Collections** are left as main has them: `getCollections` already pages and counts its members in SQL (`collectionTallySql`). The commit this task came from had its own `getCollectionPage`; it was dropped when the work moved onto main.
- The smaller relational lists the survey named (`people.ts`, `organizations.ts`, `venues.ts`, `series.ts`, `orders.ts`, `places.ts`) are left as they are.

## Completion Notes

Measured on a private preview with the 5,000-book scale seed and 4,000 readings, best of three, before and after on the same data:

| Page | 40 ms per query | 200 ms per query |
| --- | --- | --- |
| /library?sort=rating | 0.45-0.52 s → 0.14-0.17 s | 0.76-0.80 s → 0.46-0.52 s |
| /library?sort=year | 0.48-0.50 s → 0.13-0.16 s | 0.75-0.88 s → 0.45-0.46 s |
| /library?sort=authorLastName (unchanged path) | 0.24-0.26 s | 0.54-0.59 s |

- Rating and year now take less than the author sort, as the ticket asked.
- In the database, without JIT: the People query 15.7 → 3.3 ms (1,515 people).
- On this seed /people takes the same wall time before and after at 40 and 200 ms; its gain is in database time.
- **Same lists:** the ordered links on /library (rating both ways, year both ways, page 3 of rating, recently added, last read, Up next), /people (name, recently added, birth, page 2 by last name) match the order written directly in SQL. Ratings have 10 values over 5,036 books, so the ties by id are exercised.
- **Tests:**
  - `half-star-ratings` (DB): a rating sort paged two at a time gives one order across pages, ties by id, and each card keeps its relations.
- **Checks:** `pnpm typecheck` clean, `pnpm test` 730 files passed, 17 DB suites (231 tests) pass on a private PostgreSQL 16. The browser audit passes 36 of 36 page loads on /collections, the dashboard, /library?sort=rating and /people in Chromium, Firefox and WebKit at 1440, 768 and 390. `page-weight.js`: /harmonize (pre-existing) and /reading at 1.05 s of its 1 s budget fail; /reading does not use these lists, and its time is the suggestion query (about 0.4 s at this seed).

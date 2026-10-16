# Task 0840: Reading, Suggestions and Stats stay fast at 5,000 books

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-885, from item 4 of `findings/scale-statistics-2026-10-16.md`. With about
5,000 books, `/reading` and `/reading/suggestions` each took about 2.1 s of
server time, over the 1,000 ms budget. `/reading/stats` waited on the database
twice in a row.

The finding blamed the suggestions' book query, which returns every book. A
profile showed that query takes 0.45 s and is needed, since every book is
scored. Most of the time went elsewhere. After scoring, maximal marginal
relevance (the step that keeps the top of the list varied) put every one of
the 4,400 candidates in order: about 1 s. Yet the hub shows three
suggestions, and the Suggestions page shows 24 a page.

## Implementation Details

- `src/lib/reading/suggest/score.ts`:
  - `diversify` takes a `limit` and stops after that many picks. Each pick
    depends only on the picks before it, so these are exactly the first
    picks of the whole order.
  - `suggestTop(ctx, params, limit)` returns those first picks and the
    number of suggestions in all. The limit can be a function of that total,
    for a page number past the last page. `suggest` is unchanged: it calls
    `suggestTop` with no limit.
- **The callers order only as far as they show.**
  - The hub (`reading/(tabs)/page.tsx`) orders three.
  - The Suggestions page orders up to its page, and at least Pick one's ten.
    The count beside "Read next" comes from the total.
  - `GET /api/readings/suggestions` orders up to the page it was asked for.
- **`reading/(tabs)/stats/page.tsx`:** the year's fifteen sections start with
  the year the address names, beside the list of years they are checked
  against. Before, they waited for that list. The settings come from the
  cache. Only a year with no reading, typed into the address, reads again,
  for this year.

## Completion Notes

**How it was measured.** Production builds of main (a84ada8d) and of this
change ran against one local preview database: the survey dump plus
`seed-scale-books.sql`. That seed (in this thread's scratchpad, not committed)
adds 5,000 books with authors, subjects, themes, copies at home, ratings,
800 finished reads with a session each, and 60 books in Up Next, for 5,832
books in all.

Each figure is the median of 7 requests after 2 warm-ups. Every database
request was held for the round trip shown.

| Page | 0 ms: main | 0 ms: change | 40 ms: main | 40 ms: change | 200 ms: main | 200 ms: change |
| --- | --- | --- | --- | --- | --- | --- |
| `/reading` | 2.13 s | 0.88 s | 2.10 s | 0.83 s | 2.38 s | 1.04 s |
| `/reading/suggestions` | 2.10 s | 0.87 s | 2.15 s | 0.84 s | 2.47 s | 1.02 s |
| `/reading/stats` | 0.27 s | 0.15 s | 0.33 s | 0.21 s | 0.66 s | 0.38 s |

- **The same suggestions.** On the 5,832 books, `suggestTop` returned the
  same books in the same order as the whole list's first 3, 10, 24 and 72,
  and the same total, for the Owned, All and Wanted scopes. Ordering 24
  Owned takes 0.20 s; the whole list took 1.65 s.
- **Unit tests.** `diversify` with limits 0, 1, 3, 24, 119 and 500 matches the
  first picks of the reference order. `suggestTop` matches `suggest`'s first
  picks and total. The stats page reads a named year once, "all" once and no
  year once, and reads twice only for a year with no reading.
- **Database suites.** `reading-suggestions`, `personal-signals` and
  `reading-stats` pass.
- **Browser audit.** 45 of 45 loads pass: `/reading`, `/reading/stats`,
  `?year=all`, `/reading/suggestions` and its second page, at 1440, 390 and
  320 in three browsers.
- **Page weight at 5,832 books.**
  - `/reading`: 946 of 1,000 ms.
  - `/reading/suggestions`: 921 of 1,000 ms.
  - `/reading/stats`: 194 ms.
  - Two other routes fail at this size, and this change does not touch
    them: `/statistics` (SLN-884) and `/harmonize`.
- **What remains.** On the hub and Suggestions, most of the time left is the
  book query itself (about 0.45 s), scoring (about 0.2 s) and turning rows
  into books (75 ms). The query's JSON is about 7.9 MB at this size, about
  1.36 KB a book, mostly the editions with their copies and the taxonomy
  terms. Making it smaller would be the next step.

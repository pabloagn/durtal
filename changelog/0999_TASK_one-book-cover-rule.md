# Task 0999: One cover stands for a book in every list

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1286, from the duplication survey (findings/duplication.md, section 7). About 25 subqueries and relational orders picked a book's cover, each in its own way. They used four edition orders: first added, newest by publication year, oldest by publication year, and owned first. Posters used three orders. So one book could show one cover on its library card and another in the palette or the Start reading picker. A library card also took the first edition even when it had no cover, and drew a letter while a later edition had one.

## Implementation Details

The rule, decided by the coordinator on 19 Oct (docs/03, A book's cover):

1. The book's own chosen cover, its active poster.
2. Else the cover of the edition of its most recently added copy that is not deaccessioned and whose edition has a cover.
3. Else the cover of its earliest added edition with one.
4. Else the `CoverLetter`.

`lib/library/filter-conditions.ts`:

- `workCoverEditionSql(workId)` covers steps 2 and 3.
- `workCoverSql(workId)` returns the image key, with the poster first. Another kind has no editions, so it gets its poster.
- `coverEditionFirst(editions)` is the order for a relational `editions`, so `editions[0]` is that edition.
- `POSTER_ORDER` and `posterFirst(media)` are the media manager's order (`sort_order, created_at desc, id`).
- `coverColorSql` reads the same cover.

Moved onto the rule:

- **Relational queries:** the library cards, the duplicate panel, the carousel cards (`workCardWith`), the dashboard shelves, the series volumes, the recommender, taxonomy and collection cards.
- **SQL:**
  - the series list covers and series picker;
  - the people previews;
  - the statistics;
  - the palette;
  - the Start reading picker;
  - the collection previews and collection search;
  - the fallback for the reading lists (hub, open readings, journal, recently finished, timer, Year in review, Up next, suggestions, the import preview).
- **Book page header:** reads the cover edition as the `coverEditionId` extra. `card-edition.ts` and its test are gone.

Cards that showed only an edition's thumbnail now fall back to its full cover key, as the carousel card already did.

These keep their own edition first, since the row is that edition:

- a reading (its edition's thumbnail, else its full cover, in every reading list);
- a queued book, when an edition was queued (`queuedCover`, `lib/reading/queue.ts`); one with no queued edition shows the book's cover, not the home edition the queue reads its length from;
- a collection's edition member;
- a publisher's book list, which still prefers the owned edition among the house's own editions.

The poster order there now follows `POSTER_ORDER`, as do the identify queue's and the publisher name inbox's posters. An e-book's linked-book card falls back to the cover edition (`lib/ebooks/linked-book.ts`).

A card with one edition (the carousels, a person's books, a recommender's picks, the dashboard shelves) now counts every copy of the book (`copyCount` in `workCardExtras`), since its edition is the cover edition, which need not hold the copies. Other kinds (films, perfumes, paintings) and the timeline (poster only) are unchanged.

The collection previews computed a cover for every member. At 5,000 books with 9,772 collection works, that pushed the planned cost past `jit_above_cost`, and the JIT compile took 2.1 s. They now read through `batchedRows(..., { jit: false })` (SLN-1309).

## Completion Notes

- Rebased onto main on 19 Oct; a self-review then moved Up next's and Suggestions' fallback, the linked-book card and the identify and name-inbox posters onto the rule, gave the reading lists the full-cover fallback, and counted a one-edition card's copies across the book. Checks for the landed version are in the PR; the notes below are from the first draft.

- Test: `library-filters.test.ts` (database) covers four books:
  - two editions with a copy of the newer one (a deaccessioned copy of the older one, added later, is ignored);
  - a chosen poster;
  - a first edition with no cover, followed by two that have one;
  - no cover.
  The same cover comes back from `workCoverSql`, the library cards, the palette, the Start reading picker, and the book page's cover edition.
- `series.test.ts` caught the series picker passing `works.id` into a one-table select, where drizzle drops the table name and the subqueries' own `id` took it. It now passes `"works"."id"`.
- Scale (5,000 books, 6,672 editions, 3,502 copies), with 80% of editions given covers and 10% of books given posters, against main on the same data. Server time in seconds at 0 / 40 ms per query:
  - /library: 0.10-0.12 / 0.15-0.18 (main), 0.11 / 0.16-0.17 (branch).
  - /: 0.15-0.19 / 0.22-0.28 (main), 0.15-0.16 / 0.22-0.29 (branch).
  - /series, /people and /library page 20: the same on both.
  - The colour filter: 0.13-0.17 (main), 0.20 (branch).
  - /collections: 2.1-2.4 s before the JIT fix, 0.29-0.43 s after.
  - The rule over all 5,000 books takes 120-150 ms in one query (main's palette rule took 33-43 ms). Every per-copy lookup uses `editions_work_id_idx` and `instances_edition_id_idx`.
  - The hub's book query costs 10-20 ms more (440-500 ms).
- `page-weight.js` on the standard scale seed fails only /harmonize (2.8 s), a route this change does not touch. With the cover seed, /library is 305 KB on both builds (main's page is 1 KB larger); its cover URLs fill every card.
- Browser audit (alignment, design, overflow, touch) in Chromium, Firefox and WebKit at 1440, 768 and 390: /, /library, /people/scale-author-1, a recommender, /reading/next and /series all pass, 0 issues.
- `pnpm typecheck` and `pnpm lint` (no new warnings) are clean. Every suite passes (`test-local.py`: 8,415 of 8,417 before the series fix; the other failure is main's leader-menu test, fixed in #562 and #565).

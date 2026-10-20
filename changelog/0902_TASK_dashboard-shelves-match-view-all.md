# Task 0902: The dashboard's shelves open on what their View all lists show, and phone jumps land under the bar

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0896
**Blocks**: None

## Overview

SLN-1070, items 1 to 5 of `findings/dashboard-survey-2026-10-16.md`, and
item 3 of `findings/contrast-keyboard-survey-2026-10-18.md`. Item 6
(Copies counting copies that have left) is won't do: SLN-886 settled the
index's figures as record counts.

1. Recent people was the first writer of each of the 40 newest books, but
   its View all opened `/people?sort=recent`, by when a record was added.
2. Highest rated broke equal ratings by newest first; the library's rating
   sort by id. The five-star books read in another order.
3. Recent additions had no tie-break, and never showed View all once
   another collection was open, even with no records in it.
4. On phones, a jump from the rail's menu landed a section 64px under the
   bar: its `scroll-mt-16` added to the page's `scroll-padding-top`.
5. Reading had two "View all" links, to `/reading` and `/reading/journal`.
6. On phones, Tab stopped on a card's buttons under the section pill.

## Implementation Details

- **Recent people** (`library-stats.ts`): every writer of the newest books,
  each once, by book (newest, then id) and their place on it. `/people`
  gains that order as a sort, "Latest book" (`sort=latestBook`, in
  `getAuthors`, `authors.ts`): each writer's latest book by `distinct on`,
  then that book's id, their place on it and their id; people with no book
  last. View all opens it.
- **Highest rated**: the library's `sort=rating` breaks ties as the shelf
  does, newest first (`works.ts`), then by id.
- **Recent additions**: the shelf's query and its merge with the other
  collections break ties by id, as `sort=recent` does. View all shows while
  every card is a book.
- **Jumps** (`page.tsx`): `scroll-mt-6` at every width, so the rule lands
  24px under the top, and under the phone's 48px bar.
- **Journal**: Recently finished's link reads "Journal".
- **The pill** (`globals.css`): where it shows (below `md`, or with a touch
  pointer), the page keeps 4rem of `scroll-padding-bottom`.

## Completion Notes

- **Database test** (`integration/dashboard-view-all`, new): twelve books
  added in batches with equal ratings, so only tie-breaks decide. Recent
  additions, Highest rated and Recent people each equal the first cards of
  their list, across a page boundary too. All three fail on main.
- **In the browser** (survey dump):
  - the first cards of Recent additions (10), Highest rated (10) and Recent
    people (12) are the first of `/library?sort=recent`,
    `/library?sort=rating` and `/people?sort=latestBook`, in order;
  - a jump lands at 72px (24px under the 48px bar) at 390 and 320 in
    Chromium, Firefox and WebKit, where main lands at 112; at 1440, 24px;
  - Tab through Recent additions, Highest rated and Wanted (52 buttons)
    at 390 × 844 and 320 × 640: none under the pill in Chromium, Firefox and
    WebKit. On main 4 are covered by 22px in Chromium, and 26 and 16 in
    WebKit;
  - Reading's links are "View all" (`/reading`) and "Journal".
- **Database suites** that read these lists pass (9 files, 82 tests).
- **Audits.** The browser audit passes 27 of 27 loads of `/`,
  `/people?sort=latestBook` and `/library?sort=rating`. Page weight passes;
  `/` is 254 of 300 KB. The Latest book query takes 1.5 ms on the survey
  dump.

### Review on current main (2026-10-20)

- Main now picks a page's ids and loads its cards with one order expression
  (SLN-938), so the rating sort's newest-first tie-break joins the rating in
  one SQL fragment. `integration/half-star-ratings` orders its ties the same
  way: rating, newest, then id.
- **Checks on main after #619:** `pnpm typecheck` and `pnpm lint` clean and
  `pnpm build` passes. The browser audit passes 36 of 36 page loads of `/`,
  `/people`, `/people?sort=latestBook` and `/library?sort=rating`.
  `page-weight.js` passes. Locally, the seven database tests that failed
  before the fix pass in their five suites; the full `pnpm test:local` run
  stopped when the disk filled, so CI's database run is the full check.

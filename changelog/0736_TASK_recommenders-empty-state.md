# Task 0736: Recommenders with none show one empty state

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-834, design-polish pass four item 6 (`findings/design-polish-4-2026-10-15.md`).
With no recommenders, /recommenders still drew its whole toolbar (search, sort,
direction, Filter, the view switch and the size slider) over nothing, then "No
recommenders yet" with a second "Add recommender" under the header's. An empty
state should say why and offer one next step.

## Implementation Details

- `src/lib/actions/recommenders.ts`: `hasRecommenders()`, one `limit 1` read.
  Uncached on purpose: the cached `getRecommenders()` would hide the list for
  its whole lifetime if a recommender arrived by another path.
- `src/app/(catalogue)/recommenders/page.tsx`: reads it alongside the search
  params. With none, the page is the title and one `EmptyState` (an `h2` under
  the page's `h1`) saying what a recommender is, with the one Add button; no
  toolbar, no header Add. With some, the page is as before. The list part's own
  "No recommenders yet" branch is gone: a search with no match still gets the
  shell's "No results".

## Completion Notes

- Tests: `src/__tests__/recommenders/empty-page.test.ts` (one Add, no toolbar,
  a search in the address still shows the empty state; with some, toolbar and
  header Add stay) and a `hasRecommenders` case in the PostgreSQL suite.
- Browsers: /recommenders empty, with `?q=`, with 30 recommenders and with a
  search that matches none, in Chromium, Firefox and WebKit at 1440, 390 and
  320: alignment, design, overflow, layout and touch audits clean. Adding the
  first one from the empty state lands on its page; the list then shows it
  with the toolbar and one Add.
- Page weight: every route within budget.

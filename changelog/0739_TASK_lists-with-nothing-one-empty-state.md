# Task 0739: Lists with nothing show one empty state

**Status**: In Progress
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0736 (SLN-834)
**Blocks**: None

## Overview

SLN-842, after SLN-834 (recommenders) and the sixth reviewer's survey
(`findings/empty-lists-survey-2026-10-15.md`). A list page with nothing in it
at all drew its whole toolbar (search, sorts, Filter, views, size) over its
empty state, and an Add in the header as well as one in the empty state,
often with no word on what the page is for.

The rule, from #403: the page title, any collection tabs, and one empty state
with one sentence on what the thing is and one Add. No toolbar, no header Add,
no count line. A search or filter that matches nothing is unchanged: the
toolbar stays so the query can change.

## Implementation Details

First part (this PR):
- `src/components/shared/empty-index.tsx` (`EmptyIndex`): the title, tabs and
  one `h2` empty state. docs/03 (Empty States) states the rule.
- One database wave. Each page starts its list read and its "is there any"
  read together, and hands the list's promise to the streamed part; the old
  way (#403) waited on the check before the list started. A list that is
  never awaited (none exist) has a no-op `catch`, so its failure is not
  unhandled.
- Recommenders (`hasRecommenders`), Series (`hasSeries`), Publishers
  (`hasPublishers`, publishers only: other organizations do not count),
  People (`getAuthorCount()` with no filter), Places (`getVenueCount`,
  archived places too, so `?archived=only` still lists them) and Collections
  (`getCollectionCount("")`) each return `EmptyIndex` with none. Each list's
  old "No X yet" branch inside the list goes, except Collections', which the
  Loading and error states thread is changing.
- A taxonomy family with no items (Tags) hides its toolbar and the "0 items"
  count; its empty state is an `h2` with what an item is and one New item.
- Wording: "Add person" and "Add publisher" in sentence case.

## Completion Notes

First part:
- Tests: `src/__tests__/ui/empty-index-pages.test.ts` (each page: one empty
  state with one Add and no toolbar, the same with a stale `?q=`, the toolbar
  and header Add with some, the list read started before the check answers,
  and no unhandled failure), `collections-page-failure.test.ts`, and the
  PostgreSQL cases for `hasSeries` and `hasPublishers`.
- Browsers: each page empty, with entries, and with a search that matches
  nothing, in Chromium, Firefox and WebKit at 1440, 390 and 320: alignment,
  design, overflow, layout and touch audits clean.
- Page weight: every route within budget.

# Task 0739: Lists with nothing show one empty state

**Status**: Completed
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
- Wording: "Add person", "Add publisher" and "Add place" in sentence case;
  a tag family's empty text names what its items are for (review of #415).

Second part:
- Books (`getWorkCount()`, with its list read started beside it, as above),
  Films, Perfumes and Paintings (their unfiltered counts, started beside the
  address) return `EmptyIndex` with the collection tabs. Books drops
  "Identify editions" and the filters bar with none.
- Organizations: a stale search counts only what it matches, so with a
  search the page also reads the unfiltered count, in the same wave.
- eBooks: with no eBook at all (set-aside ones count as some), no state
  counts, no menu and no filters; one Upload eBooks. The view's own "No
  eBooks yet" branch goes.
- Reading: the tabs share a header with Start a book and Log a past read,
  which stay. Now offers only the import beside them; Up next gains its
  sentence; Journal (no reading has a format, so none exist) drops its
  filters and its second Start a book; Notes moves its one Add a quote out of
  the header into the empty state. docs/03 records the exception.

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

Second part:
- Tests: `src/__tests__/ui/empty-collection-pages.test.ts` (Books, Films,
  Perfumes, Paintings and Organizations rendered empty, with a stale `?q=`
  and with some; Books' list read starts before the check answers; eBooks
  and the Reading tabs by their source), `up-next.test.ts` and
  `loading-audit-states.test.ts` updated.
- Browsers: the ten pages seeded and emptied, in Chromium, Firefox and
  WebKit at 1440, 390 and 320: alignment, design, overflow, layout and touch
  audits clean (189 loads). Each empty page shows one h2, no search or
  filter field, and one Add (Reading: one Start a book).
- Page weight: every route within budget.

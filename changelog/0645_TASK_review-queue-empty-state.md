# Task 0645: The review queue's empty state clears its filters

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Loading and error states audit, finding 9
(`findings/audit-loading-2026-10-15.md`). When the review queue's search or
filters matched nothing, the page showed one grey line, "No eBooks match
these review filters.", with no way to clear them.

## Implementation Details

- `review-view.tsx`: an empty queue uses the shared `NoResults`. It says
  what matched nothing and offers Clear search, Clear filters, or Clear
  search and filters. Clearing keeps the open section. With no search or
  filter, the queue is simply empty: `EmptyState` says "No eBooks to
  review", with no clear.
- `NoResults`' Clear is a ghost button on main, which the layout audit
  flags as a plain-looking command. #325 (task 0611) gives it the
  secondary look on all 15 list pages, so this change leaves
  `no-results.tsx` to it and the review queue takes that look when #325
  lands.
- Test: `src/__tests__/ui/review-empty-state.test.ts`.

## Completion Notes

- Measured on a production preview in Chromium, Firefox and WebKit, at
  1440, 1024, 768, 390 and 320, with a search, with filters, and with
  both:
  - the empty state shows the matching Clear;
  - Clear loads `/ebooks/review` with its rows;
  - alignment, overflow, design and touch audits are clean, and Clear is
    44px tall on touch.
- With the ghost look, the layout audit listed Clear as a plain-looking
  command in all three engines. With the secondary look (first drafted
  here, then left to #325), nothing is listed on the 12 list pages
  measured, in three engines at 1440, 390 and
  320: review (search, filters), books, people, films, series, publishers,
  organizations, places, recommenders, the journal and highlights.
  Alignment, overflow, touch and design are clean there too.
- `page-weight.js` passes. Typecheck clean, lint no errors, UI and e-book
  tests pass (212 files). No migration, no new package.

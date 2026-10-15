# Task 0700: Library statistics

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

SLN-742: a Statistics section on the dashboard and a full Statistics page
(`/statistics`) about the books he owns, after Letterboxd's member stats:
headline numbers, when the books were written, the busiest years as covers,
languages, countries and categories, a breakdown in rings, ratings, authors
and publishers, copies, and the oldest, newest, longest and shortest book.
Reading keeps its own stats (`/reading/stats`); the page links there.

## Implementation Details

- `src/lib/statistics/library.ts` (new): the queries. A book counts when
  one of its editions has a copy that is not deaccessioned (the library's
  owned rule); editions and copies count the held ones. Aggregates only,
  every number cast to float8; covers come from the active poster, else the
  first edition's cover, as the people cards' previews do.
- `src/lib/statistics/charts.ts` (new): the year and decade buckets of the
  timeline (at most 200 years and 60 decades, older books counted apart) and
  BC labels.
- `src/components/statistics/` (new): `WrittenChart` (thin bars shading sage
  to blue, Years or Decades, in the shared `ChartFrame`), `SplitRing`,
  `CoverLink` and `CoverStrip`, and `DashboardStatistics`, the dashboard
  section's body in its own Suspense boundary with a skeleton.
- `src/app/(catalogue)/statistics/page.tsx` and `loading.tsx` (new).
- `RankList` takes a tone (sage by default, as before; blue and gold).
- Dashboard: the section is mounted after Wanted until the dashboard
  redesign (SLN-739) gives it its slot between Recent additions and
  Collections.
- `scripts/qa/page-weight.json`: `/statistics` at 400 KB and 1000 ms.
- Docs: `docs/04_ROUTES_AND_VIEWS.md`, Dashboard and Statistics.
- Tests: `src/__tests__/statistics/charts.test.ts`,
  `src/__tests__/integration/library-statistics.test.ts` (owned books only;
  wanted books, deaccessioned copies, films and translators stay out).

## Completion Notes

- No migration and no new package: every number comes from existing tables.
- Checked on a production preview with a disposable seed of 146 books,
  163 copies and generated covers, in Chromium, Firefox and WebKit at 1440,
  390 and 320.

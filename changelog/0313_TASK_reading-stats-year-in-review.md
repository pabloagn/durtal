# Task 0313: Reading stats, insights and Year in review

**Status**: Completed
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0306 (SLN-449), 0308 (SLN-451), 0310 (SLN-453), 0312 (SLN-455)
**Blocks**: Reading tracker step 14 (SLN-458, the export and the stats API)

## Overview

Step 12 of 15 of the reading tracker (SLN-442, sub-issue SLN-456). Stats that
only a catalogue can give: what was read, how, where, in which language and
translation, from which shelves, how long books waited, how the recommenders'
picks turned out and how long the unread pile would take. Every chart is
honest about imprecise dates, works by keyboard and screen reader, and is
drawn without a chart library. A Year in review tells each year's story and
prints. No migration.

## Implementation Details

- `src/lib/reading/stats.ts`: one function per section, each taking a year or
  `null` (all time) and returning plain numbers (every numeric column and
  average `float8`), from a handful of aggregate queries, never one per book.
  Never cached. Pages only from `countedPagesSql`; hours and reading days
  from ended sessions (the running timer never counts); the read's rating
  (`readingRatingSql`) everywhere but the recommenders (`tasteRatingSql`);
  "Where" by `readings.location_id`; owned by `ownedBookCondition`. A year's
  charts take day and month precision, a year-only date goes in a "?" bar,
  an unknown date only in the all-time totals, each named in a footnote.
  Weekday and time of day use each session's local start
  (`started_at at time zone time_zone`).
- `/reading/stats`: the year chips (`?year=2025`, `?year=all`, else the
  current reading year), "Set a reading goal" (`GoalDialogButton`) and "Year
  in review" in the header, and fourteen sections in the issue's order, each
  left out without data. This year's goals show as their cards; a past
  year's as results ("28 of 30 books in 2025"). The unread pile is always all
  time and links to `/library?reading=unread&holding=owned` with the same
  count.
- Charts (`src/components/reading/charts/`): `ChartFrame` (one tab stop, a
  group named after the chart, arrow keys, Home and End, a caption line and a
  polite live region, "Show as table"), `BarChart` (vertical, horizontal
  under 480 px) and `CalendarHeatmap` (week rows from the reading week start,
  four blocks, Up and Down by a week, its own scroller under 600 px). The SVG
  is `role="img"` with the summary as its label and nothing focusable; its
  width comes from a `ResizeObserver`, its height is fixed, text is never
  scaled. Labels sit on their marks' cap-height center (`CAP_HALF`). Pure
  parts in `src/lib/reading/charts.ts` (scales, ticks, the calendar,
  `moveFocus`, fixed English labels) and `src/lib/reading/insights.ts`
  (five templates, at least 5 books per group, half a star or 20% apart).
- The authors map (`authors-map.tsx`) is not reused: it is the People page's
  (Mapbox, its own view preferences and filters). "Where they come from" is a
  ranked list of countries, each linking to the People page's nationality
  filter.
- `/reading/year` (the years with finished books, "2025 · 31 books"; empty:
  "No finished books yet" with "Log a past read") and
  `/reading/year/[year]` (a 404 for a year without finished books): the
  numbers, each goal's result and the year's weeks of reading, the covers by
  month, five highlights, authors, countries and translation, the busiest
  month and the favourite passage, each block linking to its evidence.
- `ReadingTabs`: the Stats tab is on, and current on `/reading/year` and
  below too (`also`).
- On this day on `/reading`: books finished or started on this calendar day
  in earlier years (day precision, three at most, with the read's rating);
  the server sends its reading day and a day on each side, the line shows
  the browser's. In January, a link to the year just ended.
- Print (`@media print` in `globals.css`): light tokens, the sidebar and the
  phone bar hidden, the page at full width, colors as drawn. The review's
  controls are `print:hidden`, its blocks `break-inside-avoid`, its covers
  load at once.
- Page weight budgets: `/reading/stats` 400 KB, `/reading/year` 300 KB,
  `/reading/year/*` 400 KB (the newest year).
- Docs 03 (charts, print), 04 (the three pages, On this day, the Stats tab)
  and 06 (`stats.ts`).

## Completion Notes

RESULTS

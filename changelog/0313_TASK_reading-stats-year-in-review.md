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

- Tests: `scripts/qa/test-local.py` (every suite, a disposable PostgreSQL
  16): 208 files and 2,327 tests, none skipped. New: the database suite
  `reading-stats` (15: precisions and unknown dates in totals and charts;
  pages from p. 150, after going back and through the closing session, an
  audiobook with no pages named; the running timer in no hours, day or
  shade; 21:30 in Mexico City on its local day and evening; an audiobook
  session of a print reading under audio; Where by the reading's home after
  a copy moved; the read's rating, the book's for an only read, nothing for
  an unfinished book, recommenders equal to `tasteRatingSql`; shelf time and
  its footnote, a deaccessioned copy's date ignored; the unread pile equal
  to `getWorkCount` with `reading=unread` and `holding=owned`, per-home at
  hand; every number a number; the years, the review's blocks and its 404;
  On this day), the unit suite `stats-charts` (14: scales and ticks, the
  calendar for both week starts and a leap year, `moveFocus`, labels,
  `?year=`, insight thresholds) and the component suite `reading-stats` (6:
  one tab stop and an SVG image with nothing focusable per chart, arrows,
  Home and End in the caption and the live region, the calendar by day and
  week, "Show as table" equal to the image's label, the header's goal
  dialog, the Stats tab on `/reading/stats`, `/reading/year` and
  `/reading/year/2025`). `pnpm typecheck` and `pnpm deadcode` are clean;
  `pnpm lint` has 81 warnings, as on main.
- Page weight on a production-build preview with a seeded 2025 (47 finished
  books, 6 abandoned, 222 sessions), before (SLN-455) and after on the same
  data: `/` 263 then 264 KB, `/reading` 91 then 93 KB (On this day),
  `/reading/journal` 244 then 245 KB, `/library` 299 KB both. New:
  `/reading/stats` 80 KB (this year; 2025 176 KB, all time 161 KB),
  `/reading/year` 50 KB, `/reading/year/2025` 150 KB. Every route within
  budget.
- Server time of `/reading/stats`: 36 to 48 ms for the seeded 2025 and 28 to
  32 ms for all time; its queries took 72 ms in all, the slowest 10 ms. With
  1,106 readings and 3,231 sessions (622 books finished in 2025): 141 to 152
  ms and 194 KB for 2025; 66 queries, 151 ms in all (run in parallel), the
  slowest 49 ms. The same load first made the Year in review 960 KB: the
  cover wall now shows 12 covers a month, then a "+30" tile to the journal,
  and new authors 24 names, then "and 273 more", so it is 286 KB.
- Browsers, all headless, never a window: Chrome, Firefox and WebKit at
  1440, 768 and 390 px, 17 steps on the seeded year and 5 on the heavy one
  (the stats sections, All time, a nearly empty year, the keyboard, the
  table, a tooltip, `/reading/year`, the review, the hub). No alignment
  deviation over 0.5 px, no contrast flag, no unnamed control, no overflow;
  WebKit's console errors are the covers the preview has no S3 image for.
  Measured: every chart label sits within 0.01 px of its bar's or cell's
  cap-height center (it was 1.37 px off in the horizontal bars before
  `CAP_HALF`), the rows of text share one baseline (0 px), and charts side
  by side share one height. Right twice reads "February 2025: 4 books" in
  the caption and the live region with one outline; Right then Down twice
  in the calendar reads "15 Jan 2025". Hover tooltips open on the SVG bars
  in all three ("January 2025: 3 books"); `tipFor` needed no change.
  VoiceOver was not run: the live region was checked in the DOM.
- Print: Chrome's and Firefox's own PDFs of the 2025 review are 4 pages each
  (190 and 193 KB), light, without the sidebar, the tabs or the buttons;
  WebKit with print media matches. With 14 mm margins Chrome cut the right
  edge's last pixel on Letter, so the margins are half an inch (checked on
  Letter and A4); the main column's margin transition is off on paper.
- Journeys on a production-build preview: `reading` passes with its new
  steps (this year's stats and All time, a pages goal from the stats header,
  the Year in review from its list, the review on paper) and `import` passes.
  The seeded favourite quote of the stats data competes with the journey's
  passage of the day, so the journeys ran on the same data without it.
- On the seeded year the insights read "Borrowed books get higher ratings
  than your own copies (4.0 against 3.5)" and "You finish 9 of 10 books you
  start", each with its numbers and a link to the journal.

## Review fixes (PR #110)

- Co-authors were left out of the author numbers: `authorStats` joined
  `work_authors` on `role = 'author'` only, so a co-authored book counted its
  first author alone (most read, new authors, countries, gender). It now
  takes every writer role (`WORK_AUTHOR_ROLES`), as the rest of the app does;
  a database test checks Deleuze and Guattari on one book.
- Bar labels overlapped when a chart had many bars (40 decades gave 39
  overlapping pairs at 1440 px and 77 at 768): `barsFit` lays the bars down,
  one per row, when their labels would not fit side by side (about 7 px a
  character, 8 px apart). The heights are already shared, so nothing moves;
  every other chart stays upright.
- `durationWords(365)` read "1 years": it now reads "1 year".

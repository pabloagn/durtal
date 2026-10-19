# Task 0990: The reading-days calendar shades days known only by a finish

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1170, from the statistics survey (findings/statistics-survey-2026-10-18.md, item 1). On /reading/stats, "Reading days in 2026: 139 days" sat over 365 blank cells: a day known only by a finish comes back with 0 minutes and 0 pages, and the calendar shaded by minutes (or pages), so it drew such a day in the empty shade. That is every imported history and every past read logged without sessions; in a mixed year those days looked like days without reading.

## Implementation Details

- `lib/reading/charts.ts`: `dayShade(read, value, max)`, the calendar's shade for a day: any day with reading takes at least the first shade; the busiest days still scale the rest through `shade`.
- `components/reading/charts/calendar-heatmap.tsx`: each cell takes `dayShade`, read meaning the day is in the year's reading days. The tooltip ("2 Jan 2026: read") and the summary ("Reading days in 2026: N days") already counted those days, so the drawing now agrees with both.

## Completion Notes

- Preview with the reader seed plus 31 finish-only days in 2026 and ten timed days in February: the calendar draws 40 shaded days for "Reading days in 2026: 40 days", the finish-only days in the first shade and the timed days scaled up to the fourth, in Chromium 1440, Firefox 390 and WebKit 320.
- Alignment audit on /reading/stats?year=2026, three browsers at 1440, 390 and 320: 0 issues, overflow 0.
- `page-weight.js`: exit 0, /reading/stats 158 KB.
- Tests: `src/__tests__/reading/calendar-finish-days.test.ts` (a finish-only day, a mixed year); `pnpm test` passes.

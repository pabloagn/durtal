# Task 0993: Chart titles, short captions, a scale on the written chart, ring names

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1172, from the statistics survey (findings/statistics-survey-2026-10-18.md, findings 3, 4, 9 and 10). Four problems:

- The two Over the year charts had no visible title or unit.
- Every chart printed its whole summary under it, and assistive technology read it up to four times.
- When they were written had no value scale.
- The split rings' names repeated the title and left out the share.

## Implementation Details

- **`ChartFrame`** (`components/reading/charts/chart-frame.tsx`):
  - A `title` prop draws a visible `type-caption` title over the chart. The title names the figure (`aria-labelledby`) and is hidden from assistive technology, so it is said once. Without a title, the figure is named by the chart's label (`aria-label`), not by its caption.
  - Before a point has focus, the caption shows `brief`, or the label when there is none. The whole chart in words stays only on the SVG's `aria-label`.
  - `BarChart` passes both props through. `ChartFrame` no longer takes `summary`: each chart writes it on its own SVG.
- **Over the year** (stats page): titled "Books finished" and "Pages read". The caption reads "35 books in all; the most in March 2024, 8 books"; the highest point is left out when only one bar has a value.
- **When they were written** (`components/statistics/written-chart.tsx`):
  - One tick at the tallest bar's count, written at the left over a grid line at that height.
  - The caption reads "125 books, 1825 to 2024".
- **Split rings** (`components/statistics/split-ring.tsx`): the figure is named "Read: 52%, 2,151 of 4,167". The drawing, the share and the legend are hidden from assistive technology.
- `docs/03_DESIGN_LANGUAGE.md`, Charts: the title and the caption rules.

## Completion Notes

- **Chromium `ariaSnapshot`** on a preview with the stats seed:
  - Over the year: figure "Books finished", then the group, then the image with the month-by-month summary, then the one-line caption and Show as table. The summary is said once.
  - Ring: `figure "Read: 26%, 34 of 133"` and nothing more.
  - Written chart: figure, group, image, caption "125 books, 1825 to 2024".
- **Height at 320:** each caption under Over the year is now one line, where it was the whole month list. With 2024's readings the section is 670px; every value is still in Show as table and on the image.
- **Audits:** alignment and design audits are clean, with no overflow, on /reading/stats (all time and 2024), /statistics, /reading/year and the dashboard. Checked in Chromium, Firefox and WebKit at 1440, 390 and 320.
- **`page-weight.js`:** exit 0.
- **Tests:**
  - `chart-frame.test.ts`: the brief or the label as the caption, and the title naming the figure.
  - `written-chart.test.ts`: the tick and the caption.
  - New `split-ring.test.ts`: the name with the share, with the rest hidden.
  - `reading-stats.test.ts`: Over the year's title and caption, with the summary on the image.

# Task 0994: The printed Year in review names every book; Statistics without owned books keeps what it has

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1174, from the statistics survey (findings/statistics-survey-2026-10-18.md, findings 11 and 12):

- The printed Year in review showed 12 covers a month and a "+24" tile, so 205 of the survey's 349 books never reached the paper.
- /statistics with no owned books showed only its empty state. That hid the reading numbers and the other collections.

## Implementation Details

- **Year in review** (`reading/year/[year]/page.tsx`): each month has a second list of every title, with its rating, in two columns. It is shown only in print (`hidden print:block`), and the covers and the "+N" tile are `print:hidden`. The screen is unchanged.
- **Statistics** (`statistics/page.tsx`): with no owned books, the empty state now sits over the Reading and "The other collections" sections, each shown when it has data.
  - The empty state's title becomes an `h2`, under the page title.
  - Reading's footnote leaves out the comparison with the Breakdown there, since there is no Breakdown.

## Completion Notes

- **Print**, on a private preview with 65 books finished in 2024 (38 in March): the screen shows 12 covers and "+26" for March. Chromium's A4 PDF lists all 65 titles (`pdftotext`), with no covers in the wall. Long titles wrap within their column.
- **Statistics:** with every book set to tracked, the page shows "No books on your shelves yet", then Reading (65 finished) and the other collections (perfumes, films, paintings and their creators).
- **Alignment audit:** 0 issues and no overflow on /reading/year/2024 and /statistics, with and without owned books. Checked in Chromium, Firefox and WebKit at 1440, 390 and 320.
- **`page-weight.js`:** exit 0. /reading/year/2024 is 156 KB with 65 books. The title list adds roughly 160 bytes a book, HTML and payload together.
- **Tests:**
  - New `src/__tests__/statistics/statistics-no-books.test.ts`.
  - The reading stats DB suite checks that the year page's print lists name every book, month by month.

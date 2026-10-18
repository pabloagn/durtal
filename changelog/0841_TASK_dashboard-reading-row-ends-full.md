# Task 0841: The dashboard's Reading row ends full from 768 to 1279

**Status**: Completed
**Created**: 2026-10-16
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-891. The dashboard shows up to three books being read. From 768 to 1279
pixels the cards sit two a row, so a third card sat alone under the first
with an empty space beside it. The house rule is that shelves end on full
rows and cards keep their size, so at those widths the dashboard now shows
two cards, and the section's own link leads to the rest.

## Implementation Details

- `src/components/reading/reading-tiles.tsx` (`DashboardReading`): the third
  card takes `md:max-xl:hidden`, the same breakpoints as the grid's two
  columns. A phone (one a row) and 1280 up (three a row) still show all three.
- `DashboardReading` has one caller, the dashboard (`app/(catalogue)/page.tsx`).

## Completion Notes

Measured in Chromium, Firefox and WebKit on the survey dump (six books being
read, three shown):

| Width | Cards shown | Rows |
| --- | --- | --- |
| 320, 390, 767 | 3 | one a row |
| 768, 1024, 1180, 1279 | 2 | one full row |
| 1280, 1440 | 3 | one full row |

WebKit's 6px scrollbar moves both its grid and the hidden card by the same
amount: at 768 it still has one column with all three cards, and at 1280 two
columns with two. No page scrolls sideways at any width. The browser audit
passes 21 of 21 loads of `/` at 1440, 1280, 1180, 1024, 768, 390 and 320, and
page weight keeps `/` at 255 of 300 KB.

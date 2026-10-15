# Task 0734: Statistics says "No page counts yet", not "0 Pages", and titles its lists by what they show

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Design-polish pass three, items 9 and 10 (`findings/design-polish-3-2026-10-15.md`).
SLN-824: with no page count on any book, "In numbers" showed "0 Pages" beside
the books; no page count is not zero pages. SLN-825: with only languages to
rank, the section was still titled "Languages, countries and categories".

## Implementation Details

- `src/app/(catalogue)/statistics/page.tsx`: when the books' page counts add
  up to 0, the Pages tile shows a dash over "No page counts yet". The tile
  stays, so the eight tiles keep full rows (four at 1440, pairs on a phone). `libraryNumbers` already sums
  them, so a page count of 0 counts as none, as the unread pile does (#381).
- `src/lib/statistics/charts.ts`: `originsTitle` names the lists the section
  shows, joined in words ("Languages", "Languages and categories",
  "Languages, countries and categories"). /statistics has no section rail;
  anything that lists its sections should take the same title.
- `docs/04_ROUTES_AND_VIEWS.md` (Statistics) says both.
- Test: `src/__tests__/statistics/pages-tile-and-origins-title.test.ts`.

## Completion Notes

See the PR for the browser checks.

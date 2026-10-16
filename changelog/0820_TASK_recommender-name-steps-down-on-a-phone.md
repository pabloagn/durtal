# Task 0820: A recommender's name steps down on a phone

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-843. A recommender's page drew its name at 46px whatever its length,
beside its favourite and Actions in a header of its own. Every other detail
page uses the shared title row, where a name past 30 letters is 38px on a
phone and past 60 is 30px, and the controls go under a name too long to sit
beside them.

## Implementation Details

- `src/app/(catalogue)/recommenders/[id]/page.tsx`: the name is a
  `DetailTitleRow` with `controls="free"` (as on series pages: the star and
  menu go under any name too long for them), its controls in
  `DetailControls`. The website, count and reading lines follow under it.
- The "No books yet" line breaks a long unbroken name instead of scrolling
  the page sideways (Firefox and WebKit at 390 and 320).
- `DetailControls` (`src/components/shared/detail-layout.tsx`) no longer
  carries `type-page-title` itself: it takes the row's size, which steps
  down with the title. A cleanup: on main its own class already matched the
  step-down rule inside the marked row, so the controls render as before
  (the second reviewer measured them on the cap height on main and here).

## Completion Notes

- Tests: `detail-title-row.test.ts` lists the recommender page among the
  detail kinds and pins the controls' inherited size.
- Browsers: recommenders named "Ana", a 34-letter name, a 65-letter name and
  a 51-letter unbroken word, and every other detail kind (book, film,
  painting, perfume, organization, place, series, publisher, person), in
  Chromium, Firefox and WebKit at 1440, 390 and 320: alignment, design,
  overflow, layout and touch audits clean (126 loads). Names step 46, 38 and
  30px at 390, and 38, 30 and 30px at 320.
- Page weight: every route within budget.

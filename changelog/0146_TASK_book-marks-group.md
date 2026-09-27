# Task 0146: One "Marks" group for Rare and Anathema

**Status**: Completed
**Created**: 2026-09-27
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0144
**Blocks**: None

## Overview

SLN-337: the special labels on a book fall under one taxonomy, "Marks". The library filter shows one group that lists Rare and Anathema, and the bulk toolbar has one "Marks" menu.

## Implementation Details

- `src/lib/constants/marks.ts`: `WORK_MARKS` (Rare, Anathema), `MARKS_LABEL`, `parseMarks()`. A new mark is one entry here plus its column, badge and action.
- `src/lib/actions/utils/work-marks.ts`: `marksCondition(marks)`: works with any of the chosen marks, like the other filter groups. Used by `getWorks`, `getWorkCount` and `getWorksForTimeline` through a new `marks` filter.
- Library: one "Marks" filter group; URL `mark=rare,poison`. The old `rare=true` link still selects Rare. The "Only / Hide anathema" group from task 0144 is gone.
- Bulk toolbar: the "Rare" and "Anathema" menus are one "Marks" menu, with a section per mark.
- Data unchanged: `is_rare` (with its date) and `is_poison`. No migration.

## Completion Notes

- Unit test `marks.test.ts` for the registry and URL parsing. `poison.test.ts` covers the marks filter: one mark, both marks (either), none; count and timeline.
- Full suite with all database suites: 552/552. Typecheck and lint pass.
- Browser check on a local copy of live data: `mark=rare,poison` shows 46 books (45 rare, 1 anathema); `mark=poison` shows 1; `rare=true` shows the 45 rare books; the filter menu has one "Marks" group with Rare and Anathema.

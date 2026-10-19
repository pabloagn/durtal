# Task 0932: Reading date fields

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1097, items 3 and 4 of `findings/reading-survey-2026-10-18.md`, and item 7 of the recommenders-acquisitions survey.

- Add a session offered the days after today, which the server then refused ("This session is in the future").
- A span inside one year said the year twice: "Apr 2026 to May 2026".
- The shared date button showed the chosen day as "2026-10-18" and an empty one as "YYYY-MM-DD", where the rest of the app writes "18 Oct 2026".
- Its calendar started its weeks on Sunday, while the reading heatmap starts on Monday.

## Implementation Details

- `components/reading/dialogs/session-dialog.tsx`: the date picker's `max` is `readingDateLimit` in the session's zone, as Log progress does.
- `lib/reading/dates.ts` `formatReadingSpan`: when both ends fall in one year and neither is a bare year, the start leaves its year out: "Apr to May 2026", "3 Apr to May 2026", "Mar to 14 Apr 2019" (before, "Mar 2019 to 14 Apr 2019"). Across years both keep it: "Nov 2025 to Feb 2026".
- `components/ui/date-picker.tsx`, shared by 15 fields (the three reading dialogs, the copy form, the edition form, the wanted section and the order create and edit forms):
  - The button writes the chosen day as "18 Oct 2026". Its value and `data-draft-value` stay "2026-10-18".
  - An empty button reads "Choose a date".
  - The calendar's weeks start on the reading settings' week start (Monday, or Sunday when chosen), as the heatmap does.

## Completion Notes

- Tests: `reading/dates.test.ts` (one year said once, across years kept) and `ui/date-picker-limits.test.ts` (the button's words, the empty button, both week starts).
- Browser, in Chromium, Firefox and WebKit at 1440, 390 and 320, on a seeded preview. The fields checked were Log progress, Add a session, Log a past read, the copy form's acquisition date and the edition form:
  - The button reads "18 Oct 2026", or "Choose a date" when empty.
  - The calendar's first column is Monday.
  - Add a session, Log progress and Log a past read disable the day after today.
  - The alignment audit is clean with the calendar closed and open.
- Page weight passes on every route.

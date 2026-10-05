# Task 0312: Goals and reading rhythm

**Status**: Completed
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0308 (SLN-451)
**Blocks**: Reading tracker step 12 (SLN-456, its stats page opens the goal dialog)

## Overview

Step 11 of 15 of the reading tracker (SLN-442, sub-issue SLN-455). Optional
yearly goals in books, pages or hours, shown in neutral words, and a weekly
reading rhythm in place of streaks. Nothing is on until Joris turns it on;
nothing is ever "behind", red, "lost" or a notification. Migration 0070 adds
`reading_goals` and `app_settings.reading_rhythm_days`. It ships before step
10 (SLN-454): that step needs the e-book reader epic, which does not exist
yet, and the plan lets steps 11 to 14 go first.

## Implementation Details

- Migration `0070_reading_goals.sql`: `reading_goals` (year, metric books,
  pages or hours, target 1 to 100,000, `count_rereads`,
  `excluded_work_type_ids`, unique `(year, metric)`, no book reference) and
  `app_settings.reading_rhythm_days` (null or 1 to 7). The migration test
  lists the table and checks the column starts null.
- Counting (`src/lib/actions/reading-goals.ts`, one query per call, every
  number `float8`): books, finished readings with a known finish in the year
  at any precision; pages, `countedPagesSql` rows in the year, summed then
  rounded; hours, ended sessions' `duration_seconds` by `read_on`, the
  running timer left out. Re-reads (`rereadSql`) count only with
  `count_rereads`; excluded work types never (an id that no longer exists is
  ignored). Each goal also gets the day it was reached and that finish's
  precision, its count over the last 90 days, the average length this year
  and last, and its audiobooks without a page count.
- Words (`src/lib/reading/goals.ts`, pure): "12 of 30 books"; "On pace"
  (within one book, or 1% of a pages or hours goal), "2 books ahead", "18 to
  go: about one every 2 weeks from now", "Goal reached on 14 Oct" (or "in
  October", "in 2026"); `NEVER_SAID` lists the words that never appear. The
  week and the 12 weeks before it (`rhythmView`), Monday or Sunday first.
- `/reading`: "Goals this year" (a card per metric with a sage bar, the line
  and an info popover: how it counts, the pace of the last 90 days, the
  average lengths, what is left out) and "This week" (seven marks, today
  outlined, "4 of 5 days this week", 12 bars, "kept 9 of the last 12
  weeks"), after Currently reading. A "Goals" menu in the header sets a goal
  or opens the rhythm setting. The cards and the rhythm draw with the
  server's reading day, then the browser's (`useBrowserReadingDay`); when
  the browser's reading year differs the cards load that year's goals.
- The goal dialog (`goal-dialog.tsx`, loaded when opened) through one
  trigger, `GoalDialogButton`: this year or next, a target per metric (empty
  means none), "Count re-reads", the work types to leave out, and the past
  years ("28 of 30 books in 2025"). Opened from the hub's menu and from
  Settings → Reading, which also gains "Days I'd like to read each week" (Off
  or 1 to 7; "5 of 7 leaves room for rest days").
- Dashboard: one line under the Currently reading tiles, "12 of 30 books
  this year · on pace" (alone under a "Reading" heading with no tile).
- Docs 02 (`reading_goals`, `reading_rhythm_days`, the counting), 03 (the
  goal card and the rhythm), 04 (the hub, the dialog, Settings, the
  dashboard line) and 06 (the actions).

## Completion Notes

- Tests: `scripts/qa/test-local.py` (every suite, a disposable PostgreSQL 16):
  204 files and 2,285 tests, none skipped. New: the database suite
  `reading-goals` (8: precisions, unknown and abandoned; re-reads off in
  every metric and excluded work types, a deleted type ignored; pages from a
  past read from p. 100 (380), a start at p. 150 (62), a move back (262,
  never 362) and a finish from p. 400 (480); an audiobook with no pages and
  its hours; 01:00 on 1 January in Amsterdam and 21:30 on 31 December in
  Mexico City on the old year; one goal per metric; numbers as numbers; the
  rhythm by `read_on` and day finishes, both week starts, the running timer
  left out), the unit suite `goals` (7, including the word sweep over every
  fifth day of the year and the browser's Sunday in Mexico City) and the
  component suite `goal-dialog` (the trigger from a page that is not the
  hub). `pnpm typecheck`, `pnpm lint` (81 warnings, as on main) and `pnpm
  deadcode` are clean. The reading components show none of "behind",
  "streak", "lost", "fail" (the only matches are code names, such as Log
  progress's `preview.behind`).
- Migration rehearsal: the preview from the backup applies 0065 to 0070.
  I apply 0070 after the merge.
- Server times on a production-build preview, from the database log: with
  34 readings, `getGoalProgress` (three goals) 0.3 to 1.0 ms and `getRhythm`
  0.02 to 0.13 ms; with 1,034 readings and 3,021 sessions, 10 to 14 ms and
  0.09 to 0.24 ms, `/reading` 30 to 40 ms in all.
- Page weight (before the goals, then with three goals and the rhythm):
  `/reading` 89 then 128 KB (122 KB on SLN-453's preview, with its notes),
  `/` 264 then 257 KB (256 on SLN-453's; the first number is before the
  journeys, with covered recent books), `/settings/reading` 55 KB (52); every
  route within budget.
- Browsers, all headless, never a window: Chrome, Firefox and WebKit at 1440,
  768 and 390 px: the goal cards, the rhythm, the info popover, the dialog
  from the hub's menu and from Settings, the rhythm setting, the dashboard
  line. 660 to 683 elements measured per browser: no alignment deviation
  over 0.5 px, no overflow, no unnamed control; the cards keep one height
  (127 px). The first run found the header's icon-only menu 14.65 px off the
  46 px title's cap height: it is now a "Goals" text button like the
  header's others. The contrast flags are coverless book cards' initials
  (decorative, not this change); WebKit's console errors are the covers the
  preview has no S3 image for.
- Journeys on a production-build preview: `reading` passes with its new
  steps (a 30-book goal from the hub's menu, a finished book counted with a
  neutral line, a 5-day rhythm with today marked) and `import` passes.

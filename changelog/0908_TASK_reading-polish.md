# Task 0908: Reading polish: goal wording, no empty stars, no empty time-of-day chart, the notes count, Up next, "0%"

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1096, from items 8 and 9 of `findings/reading-survey-2026-10-18.md`.
Item 3 (Most re-read) moved to SLN-1116 and is left out. Item 8 (the estimate
line) was already fixed on main: it says "Log a few sessions for a finish
date".

## Implementation Details

1. **Goals wording**:
   - When this year has a goal, its openers say "Edit reading goals": the
     hub's Goals menu, the Stats header and Settings > Reading. The hub's
     own "Edit goals" stays.
   - The dialog's title follows the year it shows. It says "Edit reading
     goals" for a year with a goal, else "Set a reading goal".
   - `hasReadingGoals` (`src/lib/actions/reading-goals.ts`) is one indexed
     lookup.
2. **Stars**: a journal row shows stars only once its reading has a rating.
4. **Time of day**: the chart is left out when no session in the period has a
   start time. The weekday chart stays in its column.
5. **Notes tab**:
   - The count says what is there: "14 notes", "3 quotes", or "9 quotes and 5
     notes", with thousands grouped (`notesCountText`).
   - A note of a book with one edition no longer names the edition.
     `noteEditionsOf` marks that edition `only`.
   - Notes added at the same time (an import) sort by book, then by page,
     then by percent (`SAME_TIME_ORDER`), under Added and under Relevance.
6. **Suggestions repeat Up next**: the hub's three suggestions leave out the
   books Up next shows above them.
7. **Button names**: Up next's button on the hub says "Start reading".
9. **Book picker**: titles sort with their numbers in numeric order
   (`naturalOrder`, as organizations and venues already sort).
10. **Nothing owned**: with the default Owned scope and nothing owned left to
    read, Suggestions says "You have read every book you own", or "You don't
    own any books yet". It offers "Suggest from every book" (`scope=all`).
11. **"0%"**: `positionText` works the share out from the page when no share
    is stored ("p. 250 of 500 · 50%"). Without a page total it shows the page
    alone.

## Completion Notes

- **Browsers.** Checked on a private preview, in Chromium, Firefox and WebKit
  at 1440, 390 and 320:
  - The goals: the hub menu, the Stats header and Settings say "Edit reading
    goals" with a goal, and "Set a reading goal" once the goals are deleted.
  - Up next: with the hub's three suggestions put in Up next, the hub
    suggests three other books. Up next's button says "Start reading".
  - The notes tab, with 14 notes and no quotes, says "14 notes".
  - The picker lists Survey Book 1, 2, 10, 11 and 20 in that order.
  - A reading with no stored share reads "Reading · p. 346 of 780 · 44%".
  - No reading row in progress has empty stars.
  - With every session's start time removed, Stats shows the weekday chart
    alone, with no footnote.
  - With every copy deaccessioned, Suggestions says "You don't own any books
    yet". Its link opens every book, with 69 rows.
  - Nothing scrolls sideways, and there are no page errors.
- **Audits.** The browser audit (alignment, design, overflow and touch) passes
  54 of 54 loads. It ran on `/reading`, stats, notes, journal, suggestions and
  Settings > Reading, in three browsers at 1440, 390 and 320. Page weight
  passes every route.
- **Tests**:
  - `reading/book-page-labels`: the share from the page, and the page alone.
  - `reading/notes`: the count wording and the `only` edition.
  - `ui/goal-dialog` and `ui/reading-stats`: the dialog's and the header's
    wording.
  - The database suites `integration/reading-hub` (the picker's numeric
    order) and `integration/reading-goals` (`hasReadingGoals`) pass, with
    `integration/reading-notes`.

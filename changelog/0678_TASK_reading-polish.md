# Task 0678: Reading polish

**Status**: Completed
**Created**: 2026-10-18
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-932, the smaller items of `findings/reading-tracking-survey-2026-10-16.md`, in the ticket's order.

## Implementation Details

1. **Date pickers without a label.** `DatePicker` (`src/components/ui/date-picker.tsx`) gives its button an id of its own when the caller passes none, so `<label for>` points at it. The reading dialogs' dates were announced only as "2026-10-16, button"; all 15 uses now carry their label.
2. **The dashboard's date.** The dateline under "Dashboard" was the server's day, so a Los Angeles browser on Thursday evening read "Friday". The server still writes its day; `Dateline` (`src/components/shared/dateline.tsx`) puts in the browser's own after hydration. `PageHeader`'s description takes a node for it.
3. **"p. 0 of 240".** Before the first page the reading's label is its share, "Reading · 0%" (`src/lib/reading/labels.ts`).
4. **Page numbers grouped.** "Reading · p. 1,234 of 1,500 · 82%", and "Abandoned at p. 1,200" on the button and in the history.
5. **"250/480".** Log progress's line shows the page count the entry gives: "Page 250 of 480 · 52.08%", not "of 240" (`src/lib/reading/log-preview.ts`).
6. **Edit reading when paused.** The paused reading's menu has Edit reading, as an open one does.
7. **The re-read's title.** The start dialog is titled as the menu named it: "Start a re-read" after a finished read, "Start again" after an abandoned one.
8. **The edition picker at 320.** `Select` takes `wrap`: the value wraps and the field grows with it, 32px for one line (44px on touch). The Edition fields of Start reading, Edit reading and Log a past read use it, so "French · Edition not identified · 240 p." shows whole.
9. **On this day.** "and rated it 1.5 stars" instead of a bare "(1.5)".
10. **The estimate line.** "About 4 h left · Log a few sessions for a finish date": the second part names what is missing, the date.
11. **A past read before the book was written.** Log a past read says "This is before the book was written, in 1947. You can still log it." under the dates and still saves. The book page passes the work's original year.

## Completion Notes

- New `ui/reading-polish.test.ts` (labels, positions, titles, On this day, the early-date note, `wrap`, the dateline's zone); `book-page-labels.test.ts` and `pace.test.ts` updated.
- Production preview, Chromium at 320 without touch and WebKit with touch: the flows above as listed; the Edition field is 32px on one line, 64px on two at touch size, never cut. A Los Angeles browser with its clock on 15 Oct 19:30 reads "Thursday 15 October 2026".
- Alignment and design audits clean on `/`, `/reading` and two book pages at 1440 and 390 in all three engines; page weight ok on every route.

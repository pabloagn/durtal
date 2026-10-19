# Task 0831: The series Add books dialog shows names in full

**Status**: Completed
**Created**: 2026-10-18
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-917, from the series and collections survey
(findings/series-collections-survey-2026-10-16.md, item 6). The series Add
books dialog cut author names with an ellipsis ("Maximiliana Wilhelmina
Konstantinop..."); names are never cut.

## Implementation Details

- `src/components/series/add-series-books-dialog.tsx`: the title, author and
  "In <series>" lines wrap in full instead of truncating, and break anywhere
  for a long one-word name (`[overflow-wrap:anywhere]`).

## Completion Notes

- A 76-letter title with a long name and a 60-letter one-word name show in
  full at 1440, 390 and 320 in Chromium, Firefox and WebKit, with no
  sideways scroll; alignment, design and overflow audits clean with the
  dialog open. A source test keeps `truncate` out of the dialog.

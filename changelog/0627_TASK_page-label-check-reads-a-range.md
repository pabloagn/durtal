# Task 0627: The page label check reads a range of pages

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

The reader engine check's navigation row failed now and then in WebKit with
"EPUB 3 Roman page label missing" (277 of 278), on builds that do not touch
page labels. The reader was right: WebKit fits more of the book on one
screen, so after Go to page xii the bottom bar named the pages on screen,
"pp. x–xii", and after page 57 "pp. 55–58". The check wanted the exact
words "p. xii" and "p. 57".

## Implementation Details

- `scripts/qa/reader-navigation-checks.mjs`
  - `barShowsPage` reads the bar's "p. 12" or "pp. 11–14" and asks whether
    the page asked for is among them. Roman front matter and Arabic body
    pages are kept apart, so "p. 12" never passes for page xii.
  - After Go to page xii and page 57 the check waits up to 5 seconds for the
    bar to show the page, as it follows the landing, and a real miss says
    what the bar reads and the first words on screen.

## Completion Notes

- Measured in WebKit at 1440 on the navigation fixture: after Go to page 57
  the bar read "pp. 55–58", and after a second Go to page xii
  "pp. x–xii", both times as the dialog closed. Chromium and Firefox showed
  "p. 57" and "p. xii".
- `barShowsPage` checked against single pages, ranges, ranges that miss
  and a Roman page against an Arabic one.
- `reader-engine-check.mjs --only navigation` in Chromium, WebKit and
  Firefox at 1440, 768 and 390: 9 of 9.
- No app change, no migration and no new packages.

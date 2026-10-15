# Task 0627: The page label check waits for the bottom bar

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

The reader engine check's navigation row failed now and then in WebKit with
"EPUB 3 Roman page label missing" (277 of 278), on builds that do not touch
page labels. Go to closes as soon as the book lands, and the bottom bar names
the page a beat later, once the landing's page label is resolved; the check
read the bar the moment the dialog closed.

## Implementation Details

- `scripts/qa/reader-navigation-checks.mjs`: after Go to page xii and page
  57, the check waits up to 5 seconds for the bottom bar to name the page.
  When it never does, the failure says what the bar reads and the first
  words on screen, instead of only "label missing".

## Completion Notes

- `reader-engine-check.mjs` navigation rows in Chromium, WebKit and Firefox:
  see the PR's checks.
- No app change, no migration and no new packages.

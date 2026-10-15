# Task 0616: Harmonize's loading line fits a phone

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0611
**Blocks**: None

## Overview

From the review of #325. At 320 px, Harmonize's loading line "Scanning the
entire catalogue" took two lines, and the page's own line ("605 records · 37
checks") one. The page below moved up 27 px when the scan came in.

## Implementation Details

`src/app/(catalogue)/harmonize/loading.tsx` reads "Scanning the catalogue".

## Completion Notes

Production preview, Chromium, Firefox and WebKit at 320 and 390:
- the loading line and the page's line are each one line;
- the category cards sit at the same height before and after the scan.

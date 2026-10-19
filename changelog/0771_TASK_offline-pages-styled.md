# Task 0771: The downloaded-books pages are styled

**Status**: Completed
**Created**: 2026-10-18
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: SLN-1145 (offline worker updates)

## Overview

SLN-908. `/ebooks/offline` (Downloaded books) and `/offline` drew a white page in Times New Roman with blue links, online and offline. The `(offline)` route group had no layout, and the app has no root layout above the groups, so those pages had no `<html>`, no stylesheet and no fonts.

## Implementation Details

- `src/app/(offline)/layout.tsx` is new: it renders `MinimalRoot` with `documentMetadata`, as `src/app/reader/layout.tsx` does. The pages read no online data, so the catalogue root's providers stay out.
- The reviewer's verified fix from `findings/offline-survey-2026-10-18/offline-layout-fix.diff`, applied as is.
- `src/__tests__/ui/root-layouts.test.ts`: every top-level group or segment with a page draws a whole document with the app's styles. It fails without the new layout.

## Completion Notes

- A device that downloaded a book before this release keeps its old worker and its cached unstyled copies until SLN-1145 lands.

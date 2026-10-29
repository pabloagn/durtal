# Task 1144: Readable session import previews

**Status**: In Progress
**Created**: 2026-10-20
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-1090
**Blocks**: SLN-1090

## Overview

Show historical session dates and durations using the reading tracker’s existing wording, including previews that were already imported.

## Implementation Details

- Format the stored reading day with `formatReadingDate` and the duration with `durationWords` while loading the preview.
- Keep page and percentage ranges, missing values and note summaries unchanged.
- Project only the six values needed for display and discard that temporary projection before returning preview rows.
- Preserve stored import JSON, exact timestamps, record order, matching, commit and Undo behavior.

## Completion Notes

Focused formatting and database read-only regressions are prepared. Typecheck, tests and browser verification remain pending.

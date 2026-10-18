# Task 0813: The notifications panel keeps the focus

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-922, from the settings survey (`findings/settings-survey-2026-10-16.md`,
findings 2 and 4). SLN-921 (the Select) landed separately in 0862.

## Implementation Details
- `src/components/layout/notification-centre.tsx`:
  - Remove hands the focus to the next entry's Remove, else the one before,
    else the panel.
  - Mark all read hands it to Clear all; Clear all to the panel, which takes
    the focus (`tabIndex={-1}`) and still closes on Escape.
  - The focus moves before the button goes, so it never falls to the page body.
  - The panel's heading is functional: `type-dialog-title` (Inter, 16px), as dialog titles are, and
    Mark all read and Clear all keep one line each (`whitespace-nowrap`).

## Completion Notes
- `notifications-keep-focus.test.ts` (3 tests, all fail without the fix).

# Task 0862: Restore Select focus after a pointer choice

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-921: after a mouse or touch choice, the shared Select closes and returns focus to its own trigger, matching Escape behavior.

## Implementation Details

- Refocus the combobox trigger after an enabled option is selected.
- Cover standard and compact Select variants when focus is elsewhere during selection, and retain the disabled-option guard.

## Completion Notes

Source prepared on a fresh worktree from remote main `bdc1f24d`. Tests, full typecheck, browser journeys and alignment/page-weight checks await the shared local validation slot. Browser acceptance must cover Settings, Add book, Add instance and Edit person in Chromium, Firefox and WebKit, including pointer and touch selection. No application data or deployment changes.

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


### Grant 14 validation

At frozen UI source head `0b30f31cb5be2402c96fa594695f524121f62fb2`, the affected UI checks passed **82/82 tests** across 12 files, **0 failures and 0 skips**, in 8.56 seconds using Node 22.23.3 and one Vitest worker. Full `pnpm typecheck` then exited **0**. Reports: `/private/tmp/sln921-883-grant14-ui.json`, `/private/tmp/sln921-883-grant14-ui.log` and `/private/tmp/sln921-883-grant14-typecheck.log`.

The reviewed CI health repair `2e8738e6612407b7b6f775e99f9422a3a30a3765` merged without conflicts as `1e966c97d9dd12605fb377a0cef11b8d743854ae`. It changes only QA tests and their changelogs; the validated application source is unchanged. No build, browser, alignment or page-weight audit ran in grant 14. Those acceptance checks and full final-head hosted CI remain pending. The branch has not been pushed.

# Task 0865: Give the calendar its own Escape surface

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: Combined reading-date browser acceptance

## Overview

SLN-978: an open DatePicker must close before its parent dialog, return focus to its trigger, and leave the parent's unsaved-work guard intact.

## Implementation Details

- The calendar acquires a child surface lease while open and releases it on close/unmount. Remove its competing document Escape listener.
- Escape and date selection return focus to the trigger. Outside-click closure leaves focus at the clicked destination.
- The shared surface handler consumes repeated Escape without closing a layer or invoking its guard; existing IME, modifier and upstream-event ownership rules remain unchanged.
- Mounted regressions cover clean/dirty parent, focus, date limits/selection/clear, outside clicks, newer surface ownership, unmount cleanup, modifiers, IME/keyCode 229 and held Escape.
- Select was inspected as an analogy only. No Select change or separate reproduced Select finding is included.

## Completion Notes

Source prepared from frozen combined reading head `50cf0a548a8f2f3a43ae3368d4f6b309fb62f9be` in a separate worktree. No tests, typecheck, build or browser checks have run for this patch; those require the coordinator's local validation grant. Original failed calendar acceptance and the frozen reading/focus worktrees are preserved. No live data changes or publication.

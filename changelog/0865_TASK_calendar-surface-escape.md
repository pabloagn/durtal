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


### Lightweight validation

Grant 15-L ran the calendar, date-limit and related Escape/reader-surface suites with one worker, no database, build or full typecheck: 60 passed and one failed. The failed assertion expected the parent to restore an opener that the fixture had clicked without first focusing; the calendar-only close and trigger-focus assertions passed. The fixture now explicitly establishes that focus origin and wraps its day-focus call in `act`, without changing application code or weakening assertions.

The same bounded grant 15-L2 rerun passed **61/61 tests** across seven files, **0 failures and 0 skips**, in 8.81 seconds on Node 22.23.3, with no React `act` warning. Original evidence remains at `/private/tmp/sln978-focused.json`, `/private/tmp/sln978-focused.log` and `/private/tmp/sln978-grant15L-receipt.json`; passing evidence is `/private/tmp/sln978-focused-r2.json` and `/private/tmp/sln978-focused-r2.log`.

Full typecheck and actual pointer/touch calendar acceptance in Chromium, Firefox and WebKit remain pending. The corrected synthetic focus setup does not establish Safari pointer behavior.

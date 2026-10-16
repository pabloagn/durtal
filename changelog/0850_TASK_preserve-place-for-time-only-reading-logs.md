# Task 0850: Preserve the place for time-only reading logs

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-926: entering `3:12` for a page-tracked reading must record 192 minutes of session time while retaining its page and percentage. A later chapter entry must retain that place too.

## Implementation Details

- `recordProgress` treats time-only entries as session duration when there is no audio length or native audio position. It preserves the current position and validates the duration before any write. Native audio positions, including those without a known length, retain their existing meaning.
- The log preview explains the recorded duration and unchanged place. Desktop and touch dialogs display that duration in the optional minutes field without allowing a second value to override it. Invalid durations and time-only entries in the stop-timer dialog receive a plain error.
- Regression cases cover the server action and service directly, page/percentage preservation, later chapter entries, original session history, undo, zero added pages, derived summary percentage, unknown page counts, native audio times, and invalid or conflicting durations. Dialog cases cover desktop and touch input.

## Completion Notes

Implementation and regression fixtures prepared in an isolated worktree based on `bdc1f24d`. `git diff --check` passes.

- The first targeted `pnpm test:local` attempt passed six prerequisite Python suites, then was interrupted after the Python 3.15 CDN prerequisite remained blocked in `test_reviewed_budget_notification_subscriber_drift_blocks_old_plan`, on the fake provider's second FIFO read. A captured stack confirmed the blocking read. The owned prerequisite and runner both exited; database creation and Vitest never began.
- A fresh Python 3.12 attempt failed in the budget prerequisite because that runtime does not supply the required `os.waitid` APIs. No database or Vitest started.
- With coordinator approval, the guarded fallback verified prerequisite source bytes against `a426d630` and coverage of every current Python prerequisite before reusing the passing `/private/tmp/durtal-release-review/tests-954/summary.json` evidence. No prerequisite source or requirement was changed.
- Fresh targeted Vitest validation used Python 3.12.13, Node 22.23.3 and disposable PostgreSQL: **115 tests passed in 3 suites**, no skips. This covers `integration/reading.test.ts`, `reading/book-page-labels.test.ts` and `ui/reading-dialogs.test.ts`. Reports: `/private/tmp/sln926-guarded-tests/`. The runner removed its container and volumes.

The heavy slot was released after this bounded cycle. Typecheck, the full suite, build and browser audits remain required. No live catalogue writes, backfill, service changes or deployment are part of this fix.

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

### Post-review hold

Independent review of `6d39f9c7` found that copying the current position into a duration-only session can move counted pages between days, round a percent-tracked position, or lose an unmappable page in another edition. PR #476 is held.

Grant #5 reproduced all three failures in a fresh disposable database: September 3 incorrectly received 60 pages and September 4 received 0; 25.1% became 25%; the unknown-total page 60 became null. Only those three cases were selected; 72 other cases were intentionally excluded for this negative run. Reports are in `/private/tmp/sln926-history-repro/`; the runner confirmed `containerRemoved: true` and the heavy slot was released.

The follow-up source patch stores pure duration rows without start/end positions or an inherited chapter. Position replay leaves them out of its previous/current position chain. Current cached counters are not rewritten by a duration save, and chapter-only logs keep exact counters instead of deriving percentage again from a rounded page. Correcting a position selects the latest position-bearing row, preserving later duration rows. Fresh tests cover the three cases, undo, and both Edit and Fix last log. Earlier regression expectations were updated to require null position fields on duration rows. This follow-up patch has not yet been validated; full targeted, typecheck, full-suite and browser gates remain pending.

The additional review case (start p60, only a duration log, then edit current position to p55) remains supported. The edit creates an explicit manual position record on the latest log's day, in the same atomic write as the edited reading. It does not repurpose, retime or rewrite the duration row. New integration coverage compares that row before and after the edit, and unit coverage checks the separate position record. The existing no-log edit guard remains unchanged.

Related session UI now permits editing a duration-only row's time or note with no end position, including Undo; adding a session skips positionless rows when finding its start, and the history list omits the invented "to the start" suffix. Mounted regressions cover desktop/touch duration edits, adding +20 after a duration row or from the original start, and rendered duration versus real-position labels. These follow-up cases are prepared but not yet run.

### Repair validation — 17 October 2026

Grant #7 ran the repaired source against fresh disposable PostgreSQL, then ran TypeScript checking serially. **All 248 tests passed across 8 suites, with 0 skips; `pnpm typecheck` passed.** No failure remained in this cycle. The database runner confirmed its container and volumes were removed. No application server, browser or production process was started or changed.

| Suite | Passed |
| --- | ---: |
| `integration/reading.test.ts` | 76 |
| `integration/reading-sessions.test.ts` | 22 |
| `ui/reading-dialogs.test.ts` | 32 |
| `ui/reading-timer.test.ts` | 28 |
| `reading/update-reading-action.test.ts` | 33 |
| `reading/edit-positions.test.ts` | 43 |
| `reading/book-page-labels.test.ts` | 13 |
| `ui/reading-session-list.test.ts` | 1 |

Runtime: Node 22.23.3 and Python 3.12.13. Command: `PATH=/private/tmp/durtal-sln569-runtime/node-v22.23.3-darwin-arm64/bin:$PATH /Users/pabloaguirre/.local/share/uv/python/cpython-3.12.13-macos-aarch64-none/bin/python3 /private/tmp/sln926-history-fixed-tests.py`, followed by `PATH=/private/tmp/durtal-sln569-runtime/node-v22.23.3-darwin-arm64/bin:$PATH pnpm typecheck`. The guarded wrapper verified unchanged prerequisite source bytes against `a426d630` and all required Python suite names before reusing `/private/tmp/durtal-release-review/tests-954/summary.json`; only that prerequisite evidence was reused, while all 248 reading tests and their databases were fresh.

Reports: `/private/tmp/sln926-history-fixed-tests/summary.json`, `vitest.json` and `vitest.log`. Test execution took 128.17 seconds; fixture setup, execution and cleanup took 137.81 seconds. The pre-receipt source fingerprint was `d0d65d1fefb86e16d472c50e6bc65e387779628473573631364af50cf8683877`, based on `6d39f9c79038a39ad8ed1a7b388dc704beeef9fd`. `/private/tmp/sln926-repair-tested-source.json` records every changed file hash; all source files were verified unchanged after the tests and before recording this receipt.

The repair commit includes this receipt to avoid a separate documentation-only push. Publication requires coordinator review. The complete test suite, production build, browser acceptance, alignment and page-weight audits remain pending gates before merge.

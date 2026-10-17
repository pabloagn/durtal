# Task 0854: Limit reading dates to today

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: Task 0855 (SLN-928)

## Overview

SLN-927: reject future start, finish, abandon and past-read dates in the dialog and on the server, while accepting local today and current partial months or years.

## Implementation Details

- The calendar date in the supplied browser timezone is the date cap, matching the existing logged-session server rule. The reading-day offset still supplies the default date.
- The shared calendar gains an optional maximum. Reading dialogs pass their local limit and validate typed partial dates too.
- Server start/create/past-read schemas validate their dates. Finish and abandon validation obtains its context from the stored reading rather than accepting a client-supplied exception.
- To coexist with SLN-928, a stored start ahead of local today is allowed only if that date has already arrived somewhere on Earth (UTC+14 is the upper bound). It permits the Amsterdam-16-Oct / Los-Angeles-15-Oct case but does not bless arbitrary future dates from old bad records. A new start or past read receives no such exception.
- Regression fixtures cover Los Angeles, London and Amsterdam, current versus future partial periods, trusted existing starts, and attempts to provide an exception in the payload.

## Completion Notes

Source preparation only, on a separate branch based on `bdc1f24d`. No tests, typecheck, builds, database fixtures or browser checks have run for this patch; the heavy validation slot belongs to the CI lane. Full validation and shared-calendar call-site checks remain required before review or landing. No schema migration, historical-data rewrite or live catalogue changes.

### Combined date validation — 17 October 2026

Grant #9 passed **170 tests in 9 suites, 0 skipped**, followed serially by a passing `pnpm typecheck`. The fresh disposable database was removed (`containerRemoved: true`). The same run covers SLN-927 and SLN-928, including the direct-action omitted-date regression. Reports are in `/private/tmp/sln927-928-guarded-tests/`; the full receipt is recorded in task 0855. No build/browser process ran. Full-suite, production-build and rendered calendar/dialog audits remain pending before merge.


## Combined reading integration

The source-only merge with SLN-926 retains the capped DatePicker together with the derived, read-only session-duration input. Both submission guards remain: invalid duration before timer handling, and future-date rejection for a normal log. New mounted desktop/touch regressions assert these behaviors together and reject form submission despite a valid 192-minute duration. These added integration cases have not run yet; the fresh reading validation worker owns the combined-head checks.

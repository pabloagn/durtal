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

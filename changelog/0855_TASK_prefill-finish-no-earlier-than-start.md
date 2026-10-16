# Task 0855: Prefill Finish no earlier than the start

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: Task 0854 (SLN-927)
**Blocks**: None

## Overview

SLN-928: when a reading started in Amsterdam on 16 October is finished from Los Angeles while it is still 15 October there, the Finish dialog must open on 16 October and allow submission.

## Implementation Details

- The default is the later of the browser's reading day and the stored start. An explicit finish date supplied by the invoking flow remains unchanged.
- The date cap from SLN-927 permits that existing valid start after travel, without accepting arbitrary dates in the future.
- Pure default-date tests cover westward travel, an earlier/equal/unknown start, and an invalid future start still rejected by the date cap.
- Mounted Finish-dialog regressions verify the prefilled value, enabled Finish button and submitted date/timezone in Los Angeles and Amsterdam, including an unknown start. Only the clock's Date is faked; timers remain live.

## Completion Notes

Source prepared as a separate commit after reviewed SLN-927 source. Tests and typecheck have not run; the heavy slot belongs to the performance lane. Combined targeted validation and subsequent full-suite/browser checks remain required before landing. No database, live catalogue or service changes.

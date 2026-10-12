# Task 0452: Recover activity reads (SLN-644)

**Status**: In Progress
**Created**: 2026-10-12
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0451
**Blocks**: SLN-489 runtime acceptance

## Overview
Handle activity read failures during navigation and on an active page without unhandled rejections or false empty results.

## Implementation Details
- `activity-timeline.tsx` catches initial, refresh, comment reconciliation and pagination reads, settles loaders, retains cached or optimistic rows, and offers retry on active failure.
- Owner tokens and request generations reject departed callbacks and stale results. Confirmed deletion invalidates pending snapshots so removed comments cannot reappear.

## Completion Notes
Implementation is independently reviewed and committed. All 11 DOM regressions passed, covering failure/retry, unmount, owner changes, deletion races and pagination/refresh overlap. The full local suite passed all 6,602 tests, including database suites. Six desktop/mobile catalogue runs completed their functional assertions; 17 interrupted activity reads produced no uncaught activity exceptions. WebKit background navigation diagnostics remain recorded separately. Merge and deployment are pending.

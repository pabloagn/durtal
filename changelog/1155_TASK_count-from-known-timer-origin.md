# Task 1155: Count pages from a known timer origin (SLN-997)

**Status**: Completed
**Created**: 2026-10-29
**Priority**: HIGH
**Type**: Fix
**Depends On**: Task 1152
**Blocks**: None

## Overview

A timer that began at page 60 and ended at 61 stored one session page but contributed 61 pages to statistics when the reading's original start was unknown.

## Implementation Details

Confirmed through the real timer service and countedPagesSql in a disposable database. The shared aggregate now subtracts the highest of the original reading start, previous-session high-water mark and the timer's captured origin. Other session kinds and the existing fallback for unknown origins are unchanged. Daily, yearly, all-time, API and pace consumers share this expression. No migration or live backfill.

## Completion Notes

All 13 Python suites and 9,166 tests passed. Coverage includes daily/year/all-time/API totals and pace, known/zero/unknown origins, alternate page totals, page-less audio, backwards reading and no double-counting. Typecheck, lint and production build passed. Eighteen native Stop/Undo flows in Chromium/Firefox/WebKit at 320/390/1440 verified the API page total and preserved the exact restored timer state. The 39 populated page-weight routes passed (9 fixture skips). Deployment remains tracked in Linear.

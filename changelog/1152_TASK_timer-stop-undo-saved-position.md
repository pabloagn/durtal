# Task 1152: Preserve the saved place through timer Stop and Undo (SLN-996)

**Status**: Completed
**Created**: 2026-10-29
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: SLN-930 acceptance

## Overview

A timer starting at page 60 with an unknown original reading start stopped at page 61, then Undo reset progress to zero. Stop also overwrote the captured timer origin.

## Implementation Details

When no original start or earlier positioned log exists, keep the timer's captured origin. A different edition maps that origin through its percentage. Stop returns an Undo snapshot of the exact saved reading position, last-read timestamp and original timer fields. Undo restores those values in the guarded transaction, including nulls, the paused state and any corrected previous log. Normal recomputation for earlier-session edits remains in place. No migration or backfill; shared aggregate counting remains SLN-997.

## Completion Notes

Five regression cases failed on prior source. A native Chromium phone-width reproduction confirmed 60 → 61 → 0. The original temporary evidence files were no longer present; this recreates the documented trigger without normalizing it away. Database coverage includes real and legacy timer starts, zero/unknown positions, audio minutes, alternate editions, correction Undo, paused state, concurrent edit refusal and earlier-session changes. The full suite passed 9,159 cases; its one failing assertion was a test-only comparison of PostgreSQL numeric text with a number. After correcting that query cast, all 31 affected timer/session tests passed. All 13 Python suites, typecheck, lint and the production build passed. Eighteen native Stop/Undo flows (real and legacy origins, three engines, 320/390/1440) restored exact values and passed settled-page audits. The 42 populated page-weight routes passed (6 empty-fixture skips). Transient stacked-toast icon offsets were recorded separately; settled-page audits dismiss notifications through their controls and do not claim clean toast alignment. Deployment remains tracked in Linear.

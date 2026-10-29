# Task 1145: Record Goodreads IDs on accepted imports

**Status**: In Progress
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: SLN-1082, SLN-1090
**Blocks**: SLN-1090

## Overview

Keep Commit available for an already accepted import row when recording its missing Goodreads ID is the only remaining action.

## Implementation Details

- Include the existing eligible-ID preview count in button availability and say “Record” for an ID-only action.
- Return actual inserted IDs from the locked atomic claim and ownership journal; reused IDs count as zero.
- Preserve accepted-row eligibility, default decisions, matching, reading writes and guarded Undo. No automatic backfill.
- Show actual new-ID counts in the result without adding zero-reading noise; historical restore results report zero new Goodreads IDs.

## Completion Notes

Focused availability, result-count, duplicate/concurrent claims, retry and ownership regressions are prepared. Runtime validation remains pending.

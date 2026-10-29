# Task 1151: Explicit unrated re-reads (SLN-1116)

**Status**: Completed
**Created**: 2026-10-29
**Priority**: HIGH
**Type**: Fix
**Depends On**: Task 1150
**Blocks**: None

## Overview

Show unrated entries explicitly rather than blank separators, and explain the saved values as “Rated 1.5, then unrated, then 5”.

## Implementation Details

The ratings query uses jsonb_agg to preserve null entries through the database adapter. The complete chronological sequence is covered by a 278-reading database regression. The ratings section remains available when all re-reads are unrated. SLN-998 supplies the full-title wrapping and compact, expandable long history.

## Completion Notes

Covered by the 9,150-test run and production browser checks recorded in Task 1150, including a separate all-unrated fixture in all three engines. No migration or data rewrite. Deployment remains a separate Linear gate.

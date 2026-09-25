# Task 0122: Book hunting assessment

**Status**: In Progress
**Created**: 2026-09-25
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

SLN-315: Mark a work Rare or Difficult to Hunt and retain the calendar date of the latest availability assessment.

## Implementation Details

- Dedicated work-level marker and date, independent of catalogue status, acquisition priority and copy collector flags.
- Detail-page editor uses the shared calendar, defaults to browser-local today, supports historical dates, reassessing today and clearing both fields.
- Dated badges in library grid/list/table and a Hunting filter, including count, pagination and timeline filtering.
- Dedicated validated server action updates only assessment fields and updatedAt; activity entries record assessments and clearing.
- Additive Drizzle migration 0023 adds nullable columns and a CHECK constraint enforcing supported markers and paired dates. Existing books remain unmarked.

## Completion Notes

Implementation tested in an isolated worktree. 284 unit tests and 5 real PostgreSQL integration tests pass; TypeScript and lint pass. Browser verified marking, historical dates, reassessing today, clearing, filtering and all three library views against disposable synthetic data. No live book data changed. Live migration and activation pending approval required by HANDOVER.md.

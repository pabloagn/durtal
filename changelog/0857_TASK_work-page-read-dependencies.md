# Task 0857: Start each Work-page read when its inputs arrive

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-794: the prior parallel-read change still waited for all secondary sections
before starting collection covers, reading estimates, predictions and e-book
availability. A slower unrelated section extended those dependent reads.

## Implementation Details

- Move the Work-page read dependencies into `loadBookPageData`.
- Start covers when collections arrive; estimates when readings and the reading
  day arrive; predictions when the gate and readings arrive; and availability
  when the related-book lists arrive. Reach still follows availability.
- Keep the existing query arguments, prediction guards, cover selection and
  returned page data.
- Add tests with deliberately pending reads to verify these dependencies.

## Validation

The shared targeted run passes 68 tests across nine files, including the
new dependency tests and fresh PostgreSQL book-domain, reading-library and
library-statistics suites, with no skips. Typecheck passes. Python prerequisite
evidence was reused only after matching all 11 scripts and their source bytes
against the prior successful run; the database container was freshly created
and removed.

Full CI, matching rendered-page text, page weight and measured database waves
at 200 ms round-trip delay remain pending. No migration or live-data change.

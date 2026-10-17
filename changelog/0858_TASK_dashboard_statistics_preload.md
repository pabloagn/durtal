# Task 0858: Load dashboard statistics alongside the shelves

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-795: dashboard statistics started their database reads only after the
parent dashboard had finished loading. Their busiest-year covers waited for
all three statistics reads, although only the years are needed.

## Implementation Details

- Start a statistics data promise at the start of dashboard loading and pass
  it to the existing Suspense section.
- Start busiest-year covers as soon as the years are available.
- Send independent library-statistics SQL reads through the existing bounded
  read-batch helper. Query text and result shapes remain unchanged.
- Test dependency ordering with deliberately delayed independent reads.

## Validation

The shared targeted run passes 68 tests across nine files, including dashboard
dependency tests, statistics rendering/bucketing tests, read batching and fresh
PostgreSQL suites, with no skips. Typecheck passes. Python prerequisite evidence
was reused after exact source verification; the fresh database container was
removed.

Full CI, unchanged rendered-page output, page weight and 200 ms round-trip
measurements remain pending. No migration or live-data change.

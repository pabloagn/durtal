# Task 0864: Batch typed dashboard and collection reads

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0857, 0858
**Blocks**: None

## Overview

SLN-794 / SLN-795: independent typed reads still make separate HTTP requests
after the initial work-page and dashboard dependency changes. Prepare a bounded
follow-up using the installed Neon driver's public batch API.

## Implementation Details

- Keep one read queue per function/request. Send unchanged, unawaited select
  and relational builders through `db.batch`, preserving their driver mappers.
- Limit each request to eight reads and balance larger waves across requests.
  A single read or a driver without batching awaits each original builder once.
- Batch the eight independent reads in `getLibraryStats` and the first two
  independent reads in `getCollectionsForWork`. Keep projections, ordering and
  dependent reads unchanged. The existing raw SQL batching path is unchanged.
- Restrict the public types and runtime checks to read builders. Reject raw SQL,
  writes, prepared queries, duplicate builders, placeholders, auth tokens,
  explicit cache settings, locking and CTE options. A failed batch rejects its
  whole chunk; other chunks remain independent. No automatic retry.
- Inspect nested SQL locking clauses while respecting quoted text and comments.
  Reject sparse batch results before resolving any caller; explicit `undefined`
  remains a valid result for a missing `findFirst` row.
- Prepare type checks and tests using actual Drizzle builders, plus the real
  Neon HTTP client against disposable local PostgreSQL for mapping, decoding,
  ordered results, missing rows, bounded chunks, errors and fallback execution.

## Validation

Source and tests prepared only. Tests, typecheck, build and performance
measurements have not run; they await the coordinator's validation slot.
No performance improvement is claimed until comparative measurement.
No migration, dependency change, live data change or deployment.

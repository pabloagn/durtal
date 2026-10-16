# Task 0859: Keep statistics efficient at catalogue scale

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-884: the longest and shortest picks repeatedly scanned held editions for
each work, the written-year chart sent object keys for every year, and the
dashboard's top-rated query loaded relationships before limiting candidates.

## Implementation Details

- Calculate each work's maximum held-edition page count once in a shared CTE.
  Keep the positive-page filter and existing title/ID tie ordering.
- Transport written years as `[year, count]` pairs and reconstruct them in the
  chart. Both existing bucketing functions, footnotes, labels and interactions
  retain their inputs.
- Select top-rated IDs with the existing rating/date order and shelf limit
  before hydrating authors, editions, copies and media. Use the same ordering
  for the returned cards and keep the existing book/non-null-rating filter.
  Equal ratings and creation timestamps resolve by ascending work ID in both
  selection and hydration, making the shelf boundary deterministic without
  changing the primary rating/date ordering.
- Add regression cases for held and unheld page counts, disposed copies,
  null/zero pages, ties, compact chart transport, top-rated order and relations.
  The top-rated database test also inspects execution-plan relation loops.
  Its tied ratings and timestamps cross the shelf edge, with reverse-ID
  insertion order and repeated reads to check stable selection and ordering.
- Exercise the real chart and its frame in both tabs: rendered axis labels,
  table values, the earlier-years footnote, and keyboard captions/live values.

## Validation

Draft source only. Diff whitespace checks pass; unit/database suites,
typecheck, catalogue-scale timings, chart/browser checks and page weight await
the coordinator's validation slot. No migration or live-data change.

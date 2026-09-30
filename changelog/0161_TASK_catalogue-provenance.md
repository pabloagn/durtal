# Task 0161: Typed provenance and uncertain dates

**Status**: Completed
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-346, SLN-348
**Blocks**: SLN-356, SLN-358, SLN-359, SLN-361, SLN-363, SLN-375

## Overview

SLN-355 adds typed provider identifiers, immutable source observations, uncertain
civil dates and domain-safe measurements. Historic book metadata remains intact.

## Implementation Details

- Migration 0038 adds explicit owner foreign keys and provider/kind/ID uniqueness.
  Database guards check work kind and exactly one owner. Identifiers cannot be
  reassigned outside the existing audited merge mechanism.
- Source payloads remain observations, separate from canonical fields. Refresh
  appends one unreviewed successor, preserves history and rejects manual locks,
  older retrievals, stale revisions and competing successors. Review changes
  also use optimistic revisions. Deferred checks preserve identity across merges.
- Shared actions expose registration, observation, refresh, review and paginated
  history. A legacy adapter retains raw book/person provider IDs and edition
  retrieval timestamps/locks without guessing namespaces or rewriting columns.
- Pure merge proposals fill missing values only, report differing/locked fields,
  compare structured values independent of key order, and do not mutate inputs.
- Dates retain unknown/year/month/day/range precision, uncertainty and source
  labels. Generated numeric bounds support sorting without fabricating days.
  PostgreSQL and Zod validate leap years, BCE dates, nulls and range order.
- Dimensions, volume and duration use separate unit contracts. Invalid quantities,
  cross-domain units, unsafe URLs and oversized snapshots are rejected.
- Corrected the local Neon protocol bridge to forward already encoded boolean
  parameters faithfully; a new driver test verifies source refresh and locks.

## Completion Notes

- Full local run: **61 files, 777 tests passed, zero skipped**, plus **5 Python
  ingestion checks**. All 27 integration databases were disposable and removed.
  Reports: `/private/tmp/durtal-provenance-full`.
- Typecheck, changed-production-source ESLint and Drizzle drift checks pass.
- Populated migration reconciliation now also preserves historic provider text,
  raw external IDs, edition retrieval timestamps and manual metadata locks.
- Domain date references and source promotion interfaces remain their respective
  model/provider tasks. New domains remain gated; no production database touched.

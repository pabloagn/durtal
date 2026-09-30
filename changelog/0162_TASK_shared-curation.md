# Task 0162: Shared curation and domain holdings contracts

**Status**: Completed
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-347
**Blocks**: SLN-356, SLN-358, SLN-359, SLN-362, SLN-364, SLN-365, SLN-374

## Overview

SLN-354 separates personal curation from acquisition and ownership. Notes, rating
and recommenders retain their existing storage; migration 0039 adds a favorite
flag and prevents non-books from acquiring legacy book lifecycle state.

## Implementation Details

- Shared curation actions accept sparse personal edits only. Work locks and a
  curation fingerprint reject stale/concurrent edits; recommendations and fields
  update atomically. Failed references leave all previous data intact.
- The domain registry declares exhaustive capabilities separately from activation.
  Book mutation guards use the same lifecycle capability as future controls.
- Typed pure holdings adapters preserve the existing book ownership/status
  functions and distinguish perfume bottles/samples/decants, optional film copies,
  and explicit personal art ownership. Loans stay owned, disposition is excluded,
  unknown perfume quantity stays unknown, and museum custody cannot imply ownership.
- Persistent non-book projections will be wired with SLN-356/358/359 when those
  models exist. This layer introduces no placeholder editions or holdings.

## Completion Notes

- Full local regression: **63 files, 795 tests passed, zero skipped**, plus
  **5 Python ingestion checks**, using 28 isolated databases removed afterward.
  Reports: `/private/tmp/durtal-curation-full`.
- Tests cover curation without copies for all kinds, rollback, stale/concurrent
  edits, existing book fields, legacy partial/deaccessioned holdings, domain
  capabilities and explicit personal versus institutional art ownership.
- The installed Neon driver contract verifies atomic curation/recommendation
  writes. Populated migration checks preserve all historical book data and verify
  false favorite defaults. Typecheck, production-source lint and schema drift pass.
- New domains remain disabled and their interfaces remain separate backlog work.

# Task 0437: eBook review queue

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-495, SLN-494
**Blocks**: SLN-497, SLN-498, SLN-506, SLN-509

## Overview

SLN-496 settles pending eBooks individually and in bulk with exact previews,
stale guards and durable operation-bound undo. This checkpoint implements only
the independently approved pure preparation; the review page is not implemented.

## Implementation Details

- Strict action/edition-choice inputs, exact UTC microsecond timestamps, known
  language and ISBN checks, work history/dependency stamps and bounded chunks.
- Presentation mapping keeps pending exact/strong matches visible in Likely;
  linked automatic and partially held sections may overlap. Mapping never
  changes a matching tier or authorizes a write.
- Sentences consume structural projections of matching's LinkEffect and
  AccessionEffect contracts. They do not select editions, copies or authors.
  Inconsistent effects/counts are refused instead of hiding unadvertised writes.
- Pure receipt parsing, canonical request hashes, deterministic compensation
  operation keys, and activity-row namespace/identity checks. Receipt namespaces
  are ebook.review.{decision,undo,catalogue_status,catalogue_status_undo}.v1.
  Existing activity_events.id is the operation key. These helpers perform no
  database writes and cannot prove that any decision committed.

Database actions, protected repeatable-read queries, atomic receipt insertion,
status/history mutation, concurrency and compensation remain gated on the actual
SLN-495 landing. Eventual receipt writes must be awaited inside the mutation's
transaction, never sent through fire-and-forget recordActivity. Missing receipts
fail closed. No migration or parallel matching planner/writer is introduced.

## Completion Notes

Pure verification: 103 focused tests passed, zero skipped, on installed Node
22.23.3 and Vitest 4.1.2. pnpm typecheck, focused ESLint including tests,
and whitespace checks passed. Test report: /tmp/durtal-sln496-pure-tests.json.
The system pnpm 12 launcher refused package-manager identity verification for
the pinned pnpm 10.26.1 when registry access failed; installed runtime/test
binaries were used directly without installing dependencies; the existing pinned
pnpm 10.26.1 launcher subsequently ran typecheck successfully (with sandbox
permission for its normal TypeScript cache). Independent review
of this checkpoint is pending.
Full zero-skip tests, default Mac build, Docker, CI, all native-engine/viewport
checks, real-fixture performance, page integration and ticket completion remain
outstanding. The owner's primary files and port 3100 were not changed.

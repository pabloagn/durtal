# Task 0442: SLN-507 Offline reading and the installable app

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-493, SLN-500, SLN-502; SLN-553 shared layouts; SLN-509 build identity
**Blocks**: SLN-509 final acceptance

## Overview

Complete offline reading and the installable app. This checkpoint adds a concrete
shared IndexedDB store, replay coordinator and read-only device API on the
reviewed pure policies based on reader revision `626f4870`. Reader-owner injection,
service workers, downloads and offline pages remain integration work.

## Implementation Details

- `src/lib/reader/offline/mutations.ts`: immutable versioned mutation validation,
  the five-store contract, injected annotation-owner validation, original-device
  reconciliation and guarded legacy import planning.
- `outbox-policy.ts`: original milestone plus latest position coalescing;
  chronological claims; exact operation/revision/body/device acknowledgments;
  bounded annotation batches and lifecycle bytes; individual ignored-result
  handling; authentication/device blocking and visible-only retry decisions.
  A blocked head stops every replay trigger until explicit authentication
  reconciliation with the same device and exact operation/attempt snapshot;
  unblocking preserves its original sequence, body and timestamp.
- `download-policy.ts`: trusted unsigned delivery identity for accepted gold and
  legacy paths; app/CDN aliases; size/hash/cancellation verification decisions;
  exact storage reserve arithmetic and unknown-estimate states.
- `range-policy.ts`: full/partial/unsatisfiable/HEAD response plans, safe large
  bounds, suffix ranges, multi-range fallback and immutable strong ETags.
- `store.ts`: additive version-one `durtal-offline` IndexedDB with the five
  approved stores. Transactional enqueue/claim/acknowledgment, durable original
  milestone and latest snapshots, retry deadlines, irreversible delete sealing,
  atomic Undo/book updates, rejected results and cancellation/settlement receipts.
  Original operation identity collisions abort; duplicate enqueue cannot reset
  claims, seals or Undo deadlines. Unknown versions fail closed.
- `transport.ts`: one common position/annotation coordinator online and offline;
  Web Lock ownership across network requests, transactional foreground fallback,
  bounded abort deadlines and lifecycle bytes, expected-device headers, durable
  auth/device blocks and explicit exact-snapshot reconciliation. No beacon or
  annotation-only replayer. `createAnnotationTransport` implements the annotation
  owner's injectable shape via its trusted codecs; pending codecs must reflect
  the persisted claim and Undo seal, not only the original opaque owner payload.
- `GET /api/reader/device`: no-store cookie-only preflight, no cookie creation or
  rotation. The position POST checks `X-Durtal-Expected-Device` before parsing or
  database work; SLN-500 can reuse `expectedDeviceRefusal` in its owned route.
- Annotation domain validation, response decoding and local projection remain
  injected owner policies. No tracker effects execute in the browser. SQL schema,
  dependencies, service workers and app layouts are unchanged at this checkpoint.
- SLN-553 owns the reader and data-independent offline roots; SLN-507 will own
  their pages/store/worker. Download lists do not mount the reading engine.
  All later build integration consumes SLN-509 `BUILD_IDENTITY.buildId`.
- Current theme `#07090d` supersedes the ticket's older install-theme literal.

## Completion Notes

Shared-store checkpoint, not offline-app completion. Focused offline and position
route tests: 91 passed, 0 skipped. TypeScript and focused source ESLint passed.
`node scripts/qa/reader-offline-store.mjs` passed 18 native Chromium correctness
checks, 0 skipped, on tiny fixtures at an ephemeral localhost origin. The harness
bundles only the test entry using installed Vite, opens native IndexedDB, checks
reopen persistence, abort rollback, exact claims/acknowledgments, Undo sealing,
auth blocking, adapters and two-page Web Lock ownership past lease expiry, then
closes Chromium and removes its profile/bundle. It neither touches the manual
`:3100` session nor starts an app/database preview. These checks establish no
cross-engine, cold-open, touch, performance or deployed acceptance.

Full database suites, production/Docker builds, CI, multi-engine browser audits,
performance, trusted gestures, byte hashing/download storage, shell/worker
integration, guarded legacy-storage import, cold-open network-zero acceptance,
upgrade/rollback drills and actual HTTPS deployment remain required. SLN-493 and
SLN-500 still need to inject this shared module with their codecs and wire the
annotation route's captured-device guard; there is no mounted production reader
integration in this checkpoint. No SQL migration, dependency or live/cloud write
is included. This task remains In Progress.

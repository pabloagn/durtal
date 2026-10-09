# Task 0442: SLN-507 Offline reading and the installable app

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-493, SLN-500, SLN-502; SLN-553 shared layouts; SLN-509 build identity
**Blocks**: SLN-509 final acceptance

## Overview

Complete offline reading and the installable app. This checkpoint contains only
approved pure policies based on reader revision `626f4870`; it does not provide
an offline app, durable storage or runtime integration.

## Implementation Details

- `src/lib/reader/offline/mutations.ts`: immutable versioned mutation validation,
  the five-store contract, injected annotation-owner validation, original-device
  reconciliation and guarded legacy import planning.
- `outbox-policy.ts`: original milestone plus latest position coalescing;
  chronological claims; exact operation/revision/body/device acknowledgments;
  bounded annotation batches and lifecycle bytes; individual ignored-result
  handling; authentication/device blocking and visible-only retry decisions.
- `download-policy.ts`: trusted unsigned delivery identity for accepted gold and
  legacy paths; app/CDN aliases; size/hash/cancellation verification decisions;
  exact storage reserve arithmetic and unknown-estimate states.
- `range-policy.ts`: full/partial/unsatisfiable/HEAD response plans, safe large
  bounds, suffix ranges, multi-range fallback and immutable strong ETags.
- Helpers neither open IndexedDB nor access caches/network, APIs, database,
  service workers or browser globals. Annotation wire validation and response
  decoding remain owned by SLN-500; this checkpoint adds no competing schema.
- SLN-553 owns the reader and data-independent offline roots; SLN-507 will own
  their pages/store/worker. Download lists do not mount the reading engine.
  All later build integration consumes SLN-509 `BUILD_IDENTITY.buildId`.
- Current theme `#07090d` supersedes the ticket's older install-theme literal.

## Completion Notes

Pure checkpoint only. Focused offline policy tests: 65 passed, 0 skipped.
Repository TypeScript check and focused ESLint passed. Full database suites,
production/Docker builds, CI, browser audits, performance, trusted gestures,
byte hashing/storage implementation, cold-open network-zero acceptance,
upgrade/rollback drills and actual HTTPS deployment remain unrun and required.
No migration, dependency or live/cloud write is included. Offline shell layout,
CSP, baked build identity and rollback behavior require upstream source review
before effectful integration. This task remains In Progress.

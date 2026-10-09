# Task 0429: Layer-first eBook medallion storage

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: SLN-491, SLN-494
**Blocks**: SLN-569 acceptance

## Overview

Use the existing private durtal bucket for immutable bronze eBook sources,
versioned silver validation/provenance and accepted gold publications. Keep
existing images and legacy eBook rows/keys valid.

## Implementation Details

Strict layer-first keys partition by inspected format and source SHA-256.
Silver reports are versioned by content hash. Gold file bytes remain deduplicated;
covers and publication markers belong to the exact report's derived folder.
Registration follows complete stage checksum verification. Corrupt, DRM and
unverified formats retain evidence without gold/reader access. Plain text may
be downloaded without native-reader support; Topaz stays unverified.

Recovery checks complete publications, multipart state binds to storage and
credential identity, and composite/absent checksums require streamed verification
rather than trusting uploader metadata. Legacy duplicates and delivery remain
supported. The shared orphan reporter delegates gold/ebooks to eBook checks.

The personal CLI bridge uses explicit durtal-personal temporary login credentials
only in memory. App IAM credentials remain unchanged. The AWS planner merges
scoped eBook protections and multipart rules; it changes no bucket-wide settings,
images, managed IAM policy, CDN or budget. SLN-491 CDN rollout remains separate.
No schema migration or new dependencies.

## Completion Notes

Acceptance is in progress. The focused disposable-database and unit run passed
58 tests with zero skips, plus all three Python suites. PostgreSQL JSONB field
ordering is covered by structural publication comparison. Native and production
gates remain pending; cloud apply and source review
remain coordinator-owned. No live catalogue writes or completion claim.

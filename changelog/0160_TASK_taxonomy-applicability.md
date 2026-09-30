# Task 0160: Domain and record-level taxonomy applicability

**Status**: Completed
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-347, SLN-348
**Blocks**: SLN-353, SLN-356, SLN-358, SLN-359

## Overview

SLN-352 adds explicit taxonomy applicability while preserving every vocabulary
identity and existing book assignment. Shared and domain-specific vocabularies
remain separate, and classification no longer relies on the legacy single level.

## Implementation Details

- Migration 0037 introduces normalized family/domain/level scopes. Backfill
  preserves the declared legacy level and observed custom links at both levels.
- Subjects, themes and keywords become shared work vocabularies; art types and
  movements retain books and add paintings. Edition genres and tags remain books.
  Eight separate protected domain families use the existing custom-item store.
- Scope checks are enforced in services and all work/edition junction triggers.
  Used scopes cannot be removed. Future variant/version/art-object tables must
  invoke the same guard and extend reference checks in their domain migrations.
- A typed storage adapter replaces per-family mutation switches. Family-scoped
  edits/reordering/assignment reject foreign IDs. Merges use the audited atomic
  harmonization path and preserve assignments at both levels plus children.
- Shared assignment and legacy multi-family book edits are atomic; failed writes
  leave prior classifications intact. Linked items and nonempty families cannot
  be deleted without explicitly reassigning/removing their contents.
- Hierarchy guards reject cross-family parents and cycles, including overlapping
  moves. Future hierarchy edits maintain one-based subtree depth. Migration
  preflight reports historical cycles/cross-family parents and reserved-name
  collisions without silently repairing or reinterpreting data.
- New item slugs include UUIDs and support Unicode-only names and colliding
  transliterations. Existing URLs remain stable on rename. Legacy taxonomy pages
  remain book-scoped; domain UI is SLN-353 and subsequent page work.

## Completion Notes

- Full local regression: **59 files, 738 tests passed, 0 skipped**, plus **5 Python
  ingestion checks**, with 26 isolated PostgreSQL integration databases.
  Reports: `/private/tmp/durtal-taxonomy-full`.
- Focused tests include invalid scopes, wrong-family IDs, concurrent cyclic
  moves, subtree depths, Unicode names, protected deletion, audited merges and
  rollback of multi-family writes. The populated fixture additionally covers
  historical custom assignments at both levels and nested taxonomy preservation.
- Typecheck, changed-source ESLint and Drizzle drift checks pass. No production
  data was accessed; unrelated author-search files remain unchanged.
- Child-level taxonomy junctions and their integration tests remain part of
  SLN-356/358/359, when the corresponding domain records exist. No placeholder
  variants, versions or original objects were introduced.

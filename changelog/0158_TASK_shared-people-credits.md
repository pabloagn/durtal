# Task 0158: Shared people and ordered domain credits

**Status**: Completed
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-347, SLN-348
**Blocks**: SLN-356, SLN-358, SLN-359, SLN-369

## Overview

SLN-349 introduces shared person services around the existing author identity.
Book authors and edition contributors retain their UUIDs, URLs, biographies,
media, membership keys and roles. No duplicate identity or credit store is used.

## Implementation Details

- Migration 0035 adds explicit person domains and aliases, registered roles and
  repeatable non-book credits with attribution, credited names and film characters.
  Existing custom book roles are registered without changing their source text.
- Book junctions gain stable credit UUIDs and attribution metadata. Legacy edits
  preserve those values. Shared adapters retain the distinction between work
  authors and edition translators/editors.
- Database guards enforce domain/level roles, creator identity and film character
  scope. Legacy inserts retain book membership; shared identity creation specifies
  its domains atomically. Credit creation adds explicit domain membership.
- Shared CRUD uses the existing Neon-compatible atomic batch abstraction. Search
  includes aliases and bounded, deterministic pagination. Same-name creation
  retries only slug conflicts. Sparse updates preserve slugs and compute zodiac
  values from the updated row.
- Credit replacement locks its owner and checks the initial row snapshot before
  writing, rejecting overlapping edits. Supplied credit IDs must belong to that
  owner. Shared deletion refuses credited identities and rolls back all cleanup.
- Shared and legacy author merges use the audited harmonization transaction.
  Distinct book credit IDs are retained by narrowly scoped transfer queries;
  duplicate memberships retain the target row and the source remains archived.
- Book directories, map/timeline, stats, export, harmonization scans and slug
  maintenance exclude people with no book association. Identity pickers can
  reuse people from another domain.

## Completion Notes

- Full disposable PostgreSQL run: **57 files, 718 tests passed, 0 skipped**,
  plus **5 Python ingestion checks**. Reports: `/private/tmp/durtal-people-full`.
- Final focused run after expanding the migration fixture and correcting test
  typing: **23/23 tests passed**. Reports: `/private/tmp/durtal-people-final`.
- The populated fixture reconciles every legacy row after migrations 0033–0035,
  including historical custom credit roles, then checks book domain backfill.
- Typecheck, changed-source ESLint and Drizzle drift check pass.
- No domain UI is activated by this task. New routes, picker components and
  domain layouts remain in their UI issues; this task supplies their services.
  The existing SLN-283 production-prerender database dependency remains unresolved.
- Production data and S3 were not accessed. Existing unrelated author-search
  changes were preserved and excluded from this commit.

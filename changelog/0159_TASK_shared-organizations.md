# Task 0159: Shared organizations with publisher compatibility

**Status**: Completed
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-347, SLN-348
**Blocks**: SLN-351, SLN-356, SLN-358, SLN-359, SLN-369

## Overview

SLN-350 extends publisher identities into a shared organization service while
preserving existing IDs, slugs, aliases, imprint hierarchy and acquisition links.

## Implementation Details

- Migration 0036 retains the physical publishing_houses identity and publisher
  alias stores. The existing kind/parent pair becomes an optional book profile.
  Non-publishing organizations have neither a book kind nor an imprint parent.
- Independent normalized roles represent perfume houses, brands, manufacturers,
  retailers, film production/distribution companies, museums and galleries.
  Publisher/imprint roles are derived from the existing profile, never mirrored.
- Organization/venue links distinguish operators from owners and support multiple
  branches. Both foreign keys restrict destructive deletion. Online organizations
  require no venue or fabricated address.
- Shared CRUD is atomic and validates profile/role combinations and HTTP(S)
  websites. Aliases and canonical names have generated indexed search text;
  bounded role-filtered search uses consistent counts and ordering. New shared
  slugs include their UUID; existing slugs remain stable on edits.
- Legacy publisher options, directory, country filters, detail, mutations,
  harmonization scan and name matcher exclude non-publishing identities.
- Database triggers enforce book profiles for edition publisher links, publisher
  acquisition targets and specialties, and protect in-use profile changes.
  Non-publishing name/alias changes skip book edition rematching.
- Shared merging reuses the audited transaction and reference registry, retaining
  roles, aliases, venue affiliations and redirects. The internal audit entity
  name remains publishers until the shared harmonization UI task.

## Completion Notes

- **58 Vitest files / 728 passed / 0 skipped**, plus **5 Python ingestion checks**.
  All 25 PostgreSQL integration databases were disposable and removed afterward.
  Reports: `/private/tmp/durtal-organizations-full`.
- Ten new integration cases cover identity preservation, independent roles,
  publisher isolation, database guards, branches, deletion, aliases, concurrent
  duplicate names, merge integrity, stale previews and rollback.
- Populated migration reconciliation preserves all legacy fields/relationships
  through 0033–0036. The older publisher upgrade fixture explicitly checks the
  new generated search column as well as all prior values.
- Typecheck, changed-source ESLint, Drizzle drift and whitespace checks pass.
- No new routes are activated. Venue editing/retail observations remain SLN-351;
  organization directories remain SLN-369. Production data was not accessed.

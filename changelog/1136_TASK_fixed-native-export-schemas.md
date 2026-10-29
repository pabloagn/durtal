# Task 1136: Fixed native export schemas

**Status**: In Progress
**Created**: 2026-10-20
**Type**: Enhancement
**Tracks**: SLN-1082, follow-up to SLN-894

## Implementation

Eight ordered schema definitions replace per-file native type inference. JSON
and Parquet use raw projections with typed lists and CatalogueDate structs;
CSV/TSV retain their legacy headers, cells, ordering and formula/BOM rules.
Native timestamps come from exact SQL microsecond text. The pinned Parquet
writer uses the independently proved V1, one-page-per-group configuration,
numeric statistics/indexes and explicit UTF8-statistics omission, with only
instance-local footer annotations. No dependency or database schema changes.

Book and people projection code is separated from the route. Native targets
have an explicit field allowlist; uncredited people and distinct-book counts
are retained. The session counted-pages JOIN and running-timer exclusion stay
unchanged. Whole-entity empty native exports retain their complete schema.

## Validation status

Source checkpoint only. The synthetic adapter prototype passed separately;
that evidence does not validate these eight production projections. Focused
schema/precision/projection tests and disposable-DB checks are prepared but
have not run. Independent source review, typecheck, native Arrow acceptance,
legacy byte goldens and database validation remain required.

Goodreads name/provenance changes remain a separate SLN-1082 slice. TSV and
session/note import roundtrips remain SLN-1090. Neither SLN-1082 nor SLN-894 is
marked complete by this checkpoint. No build, deployment or publication.

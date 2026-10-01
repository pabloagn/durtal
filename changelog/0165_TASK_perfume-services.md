# Task 0165: Atomic perfume catalogue and inventory services

**Status**: Completed
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-356, SLN-351
**Blocks**: SLN-366, SLN-370, SLN-371, SLN-372, SLN-373, SLN-374, SLN-375, SLN-377

## Overview

SLN-357 adds the service layer for the perfume model from migration 0040:
create, read, update and delete for fragrances, formulations and personal
containers, plus filtered, sorted and paged lists. No schema change.

## Implementation Details

- `src/lib/actions/perfumes.ts` holds the services. `src/lib/catalogue/perfume-store.ts`
  holds the shared SQL: snapshots, section writers, date handling, list filters
  and card loading. Input rules are in `src/lib/validations/perfumes.ts`.
- Every write is one `atomic` transaction that covers every section: fragrance,
  profile, dates, houses/brands/manufacturers, credits, note pyramid and
  classification. A late failure rolls back all of them.
- Concurrency: each fragrance, formulation and container has an md5 fingerprint
  of its stored state. A save locks the record and compares fingerprints inside
  the transaction; of several saves from one read, exactly one wins. Curation
  (SLN-354) has its own fingerprint, so the two never block each other.
- Updates replace only supplied sections. Curation, sources and other sections
  stay unchanged. Credit and formulation perfumer IDs survive edits; a foreign
  ID is rejected.
- Formulations: `null` perfumers or notes inherit from the fragrance, `[]` is an
  explicit empty replacement, and each listed family replaces only that family.
  Duplicate concentration/label identities get a clear message. A flanker is
  created as its own fragrance; a size is only ever a container field.
- Containers: a patch is merged with the stored record and validated whole, so
  quantity, price and disposition rules hold for the result. The cross-field
  rules now live in one function, `checkPerfumeBottle`, used by both schemas.
  A container may move only between formulations of the same fragrance.
- Dates are immutable values. An edit creates a new value and removes the old
  one when no column in `CATALOGUE_DATE_REFERENCES` still uses it.
- Deletion: containers or retailer listings block it with a clear message.
  Comments, activity and gallery layouts go in the same transaction. Artwork is
  removed after commit by `cleanupWorkArtwork`, which shares the collection
  cleanup (`src/lib/s3/artwork-cleanup.ts`) and only touches the work's own
  media namespace and unreferenced keys.
- Lists: house or brand, perfumer (fragrance or formulation), taxonomy items
  (all must match; narrower items count; fragrance or formulation), release
  years (overlap; unknown never matches), holdings and container kinds,
  favourites and search over title and house names. Sorts: title (the book
  collation), release, recent and rating, each with an ID tiebreak. Results and
  counts share one condition. Card data loads in one query per page.
- `src/lib/db/errors.ts` turns wrapped database errors into their written
  message (trigger and assertion text) or a plain constraint message, without
  SQL or parameters. The original error stays attached as the cause.

## Completion Notes

- `pnpm typecheck` passes. ESLint on the changed source passes.
- `pnpm test:local`: 853 tests across 69 files, zero skipped, plus five Python
  checks. New: `src/__tests__/integration/perfume-services.test.ts` (12 database
  tests), a perfume case in the Neon batch contract, error-helper unit tests and
  a work-namespace cleanup test.
- Tests compare whole error messages, so SQL text that happens to contain a
  message can no longer pass a check.
- Not in scope: perfume screens (SLN-366), the typed flanker link (SLN-363),
  activity events for new domains (SLN-372) and activation (SLN-382). Creating a
  perfume still fails in production by design: `works_kind_enabled_check` allows
  only books until the reviewed activation migration.
- Superseded (SLN-361, after merging SLN-282): deletions now read their files
  with `workObjects` and remove them with `deleteUnusedObjects` from
  `src/lib/s3/cleanup.ts`; `artwork-cleanup.ts` was removed.

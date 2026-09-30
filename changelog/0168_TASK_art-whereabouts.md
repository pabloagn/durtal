# Task 0168: Sourced current and historical whereabouts of original paintings

**Status**: Completed
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-359, SLN-351
**Blocks**: SLN-368, SLN-370, SLN-371, SLN-372, SLN-373, SLN-374, SLN-375, SLN-378

## Overview

SLN-360 records where each art object physically is or was (migration 0044),
separately from who owns it, with services to record moves, correct history
and read the current location with its warnings.

## Implementation Details

- Table `art_object_whereabouts` (`src/lib/db/schema/paintings.ts`): place kind
  (venue, private, unknown, lost, destroyed), venue, place label, custody
  (permanent collection, temporary and long-term loan, private, unknown),
  display status, certainty, start and end date values, occasion, recorded and
  verified times, source and notes. Constants in `src/lib/catalogue/paintings.ts`.
- Display status defaults to unknown and is stated only at a venue. Ownership
  (on the object) never implies place or display.
- Database rules: one current confirmed record per object (partial unique
  index); confirmed periods may not definitely overlap (trigger, which also
  locks the object row); partial dates that only touch stay valid; start before
  end; no future verification; sources belong to the painting; the record cannot
  move to another object. `guard_venue_delete` now also blocks venues that
  appear in location history.
- Services (`src/lib/actions/whereabouts.ts`): `getWhereabouts` returns the
  current record, the history, conflicting claims and staleness;
  `recordWhereabouts` closes the current confirmed record and opens the new one
  in one transaction for a move; `updateWhereabouts` accepts backdated
  corrections; `verifyWhereabouts`; `deleteWhereabouts`. Every write is guarded
  by a fingerprint of the object's whole history.
- Painting reads include each object's current location with age and a stale
  flag. `getPaintings` gains a `currentVenueIds` filter. Deleting an object or a
  painting also releases its location date values.

## Completion Notes

- `pnpm typecheck` passes. ESLint on the changed source passes.
- `pnpm test:local`: 882 tests across 72 files, zero skipped, plus five Python
  checks. New `src/__tests__/integration/art-whereabouts.test.ts` (7 database
  tests): owner distinct from venue, display never inferred, storage versus
  display, loan and return, unknown/private/lost/destroyed places, uncertain
  claims and conflicts, staleness and verification, backdated corrections, two
  competing concurrent moves, venue protection and venue merges. The Neon-driver
  contract covers a move in one batch.
- Milestone 03 is complete. Not in scope: painting screens (SLN-368), venue
  pages showing collections and loans (SLN-370), museum-source enrichment with
  location verification (SLN-378).

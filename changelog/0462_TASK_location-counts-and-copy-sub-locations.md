# Task 0462: Live location counts, and sub-locations that belong to their copy's location

**Status**: Completed
**Created**: 2026-10-13
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Two fixes to where book copies sit (SLN-575, SLN-574).

- The Locations page counted each location's copies from the cached
  locations list, which only a location edit refreshed. A copy added, moved
  or deleted kept the old count for up to an hour. The counts are now read
  live.
- A copy could be saved at one location on a sub-location of another. Every
  copy writer now refuses that, and a copy moved to another location without
  a sub-location leaves its old one.

## Implementation Details

- `getLocations` (`src/lib/actions/locations.ts`) no longer loads every copy
  id. The cached list keeps the locations and their sub-locations only, which
  change through location actions that already refresh it.
  `getLocationCopyCounts()` is one grouped count over `instances`, uncached,
  so every writer is covered: the wizard, the copy actions, the REST route,
  e-book linking and accession, and cascades from editions, works and
  locations. A failed write leaves nothing to count.
- `copyShelfMismatch` (`src/lib/catalogue/copy-shelf.ts`) answers whether
  each copy's sub-location belongs to its location, with one query for a
  whole batch. A sub-location that is gone is left to the foreign key.
  - `createInstance` and `POST /api/instances` (400) refuse a mismatch.
  - `createBookFromWizard` refuses it with its other checks, before anything
    is written.
  - `updateInstance`: a sub-location the edit names must belong to the copy's
    location (old or new); a move that names none takes the copy off a
    sub-location of its old location. The copy form already clears the
    sub-location when the location changes; this is the server's rule.
  - E-book linking already checked this (`src/lib/ebooks/match/link.ts`);
    e-book accession and book orders create copies without a sub-location.
- Sub-locations cannot move between locations (`updateSubLocationSchema`
  omits `locationId`), so a check cannot go stale before its write. A
  database guard like the film, perfume and painting ones would need a
  migration, which has no path to live yet (0089+); it is left out.

## Completion Notes

- New `src/__tests__/integration/location-copies.test.ts`: counts follow an
  add, a move, a delete and an edition cascade while the cached list is held
  warm and never refreshed; a refused write leaves the count alone; create
  and edit refuse a mismatched sub-location (valid ids, wrong pairing) and
  change nothing; a move without a sub-location clears the old one, other
  edits keep it, and an explicit null clears it.
- `atomic-book-writes.test.ts`: the wizard refuses a mismatched sub-location
  and writes nothing. `rest-write-routes.test.ts`: `POST /api/instances`
  answers 400.

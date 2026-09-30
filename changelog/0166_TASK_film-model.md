# Task 0166: Films, ordered cast and crew, versions and releases

**Status**: Completed
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-347, SLN-349, SLN-350, SLN-352, SLN-354, SLN-355
**Blocks**: SLN-367, SLN-371, SLN-372, SLN-373, SLN-374, SLN-375, SLN-376

## Overview

SLN-358 adds the film domain: migration 0042 with its tables and database rules,
and the services to create, read, update, delete and browse films, versions,
releases and optional personal copies.

## Implementation Details

- Tables (`src/lib/db/schema/films.ts`): `film_details`, `film_countries`,
  `film_languages`, `film_organizations`, `film_versions`, `film_releases`,
  `film_holdings`. Constants are in `src/lib/catalogue/films.ts`.
- Cast and crew reuse `work_credits` with `film.*` roles: several directors and
  writers, one performer with several characters, billing order, credited-as
  names and unknown performers. No new credit table.
- A remake is a separate film. A cut is a version with its own runtime (seconds,
  null when unknown). A release names its version, territory (country, or a
  label such as a festival), format, date value and distributor.
- Triggers (appended to the generated migration): film kind for profiles; no
  move of a profile, company or version to another film, or of a release to
  another version; a copy's version and release must match its film; copy medium
  must match the location type; supplier, distributor and company roles are
  required and protected while in use. `organization_require_role` is a new
  generic role check. Sources must belong to the same film.
- Services (`src/lib/actions/films.ts`, SQL in `src/lib/catalogue/film-store.ts`,
  rules in `src/lib/validations/films.ts`) follow the perfume pattern: one
  transaction per write, record fingerprints, supplied sections replace only
  themselves, readable database messages.
- A version's release list keeps listed IDs, updates them in place, adds new
  entries and removes missing ones; a copy that names a removed release blocks
  the save. Version order is a film-level field checked inside the transaction.
  Neither adding a version nor reordering versions invalidates an open edit of
  the film or of a version.
- Browse filters: person, optionally limited to roles; genres (all must match,
  narrower items count); production countries and languages (any); release-year
  overlap; copies and medium; favourites; search over title and original title.
  Sorts: title, release, recent, rating and runtime of the first timed version.
- Shared pieces moved for reuse: `checkPersonalHolding` (holdings),
  `datesInOrder` (dates), `supplied` (work store) and `fingerprintSchema`
  (`src/lib/validations/records.ts`). `CATALOGUE_DATE_REFERENCES` lists the four
  new date columns.

## Completion Notes

- `pnpm typecheck` passes. ESLint on the changed source passes.
- `pnpm test:local`: 863 tests across 70 files, zero skipped, plus five Python
  checks. New `src/__tests__/integration/film-services.test.ts` (9 database tests):
  multi-role people, several characters, unknown performers, remakes with the
  same title, rollback, section edits, concurrent saves, cuts with unknown
  runtimes, releases in several territories, release list edits, copies and
  their consistency rules, protected deletes, merges, cross-domain rejection and
  count/result/paging consistency across 13 filters and 5 sorts.
- The Neon-driver contract now covers film writes. It found that reordering
  versions made open version edits stale; position is now outside the version
  fingerprint.
- The populated migration rehearsal passes with 0042 and preserves all book rows.
- Not in scope: film screens (SLN-367), reviewed metadata lookup (SLN-376),
  acquisition targets for copies (SLN-374) and the typed remake/adaptation link
  (SLN-363).

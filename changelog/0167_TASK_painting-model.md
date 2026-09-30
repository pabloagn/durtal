# Task 0167: Paintings, originals, versions and reproductions

**Status**: Completed
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-347, SLN-349, SLN-350, SLN-352, SLN-354, SLN-355
**Blocks**: SLN-360, SLN-368

## Overview

SLN-359 adds the painting domain: migration 0043 with a painting profile and
identifiable art objects, and services to create, read, update, delete and
browse them. A curated painting needs no object, edition or owned copy.

## Implementation Details

- Tables (`src/lib/db/schema/paintings.ts`): `painting_details`, `art_objects`,
  `art_object_credits`, `art_object_taxa`. Constants in
  `src/lib/catalogue/paintings.ts`.
- Objects are originals, identified versions or reproductions. Originals and
  versions of one painting need distinct labels; reproductions do not. A
  reproduction may name the original or version it reproduces, within the same
  painting; that object is then protected.
- Dimensions are optional with one unit (mm, cm, in); generated centimetre
  columns give native proportions. Unknown dimensions stay null.
- Ownership is institutional (organization, collection, accession number),
  private (owner label), personal (holding status, physical location,
  acquisition, disposition) or unknown. Accession numbers are unique per
  institution, ignoring case and outer spaces. Whereabouts are SLN-360.
- Attribution: painters are work credits; an object can replace them with its
  own ("workshop of", "attributed to") and restore them. Object technique,
  medium and support replace the painting's values family by family.
- `taxonomy_scope_in_use` now counts object taxa, so an in-use object scope
  cannot be removed. New `work_require_source` checks that sources belong to
  the painting.
- Services (`src/lib/actions/paintings.ts`, SQL in
  `src/lib/catalogue/painting-store.ts`, rules in
  `src/lib/validations/paintings.ts`): one transaction per write, record
  fingerprints, section replacement, whole-record object validation, readable
  database messages. Browse by painter (work or object), taxonomy (all, narrower
  included), movement, owning institution, creation-year overlap, holdings and
  favourites; sorts by title, creation, recent and rating. Cards carry the
  primary object's owner and size.
- `readableDatabaseError` now keeps a rule's own message when the rule raises
  it with a constraint code (for example the taxonomy scope check).

## Completion Notes

- `pnpm typecheck` passes. ESLint on the changed source passes.
- `pnpm test:local`: 874 tests across 71 files, zero skipped, plus five Python
  checks. New `src/__tests__/integration/painting-services.test.ts` (9 database
  tests): unowned original, unknown painter and dimensions, several originals
  and versions, the same accession number at two institutions, reproduction
  independence, ownership rules, section edits, concurrency, a person merge and
  count/result/paging consistency across 11 filters and 4 sorts. The Neon-driver
  contract now covers painting writes with measured objects.
- Not in scope: physical whereabouts and loans (SLN-360), painting screens
  (SLN-368), museum-source enrichment (SLN-378). Activation stays blocked by
  `works_kind_enabled_check`.

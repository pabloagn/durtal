# Task 0164: Venues for new domains and dated perfume retailer listings

**Status**: Completed
**Created**: 2026-09-30
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: SLN-350, SLN-355, SLN-356
**Blocks**: SLN-357, SLN-360, SLN-370, SLN-374

## Overview

SLN-351 extends venues for museums, galleries, perfumeries and cinemas, and adds
perfume retailer listings with dated price and stock observations (migration 0041).
Venues stay separate from geographic places and personal storage.

## Implementation Details

- `perfumery` and `cinema` join `venue_type_enum`. Labels, badge variants and the
  type list now come from one source, `src/lib/catalogue/venues.ts`, instead of
  five copies in the pages.
- Venue actions (`src/lib/actions/venues.ts`) validate every input with Zod and
  write atomically. Coordinates create an `address` place in the same write. A
  rename keeps the slug. New slugs are `<name>-<uuid>`, the pattern the branch
  uses for organizations and taxonomy items, so no read-then-write race exists.
- `archived_at` adds archive/restore. Lists and counts exclude archived venues by
  default and share one filter builder. `search_text` is a generated, normalized
  column with a trigram index.
- Orders, identifiers and source observations now RESTRICT venue deletion instead
  of nulling or cascading. A delete guard also protects venues with artwork, except
  inside an audited merge. A write guard enforces name, rating and visit-date rules
  for direct SQL too.
- The migration first checks existing venues against those rules. If one breaks
  them, it stops with a clear error and changes nothing.
- `perfume_retailer_links` identify fragrance, optional formulation, retailer
  organization, optional operated branch and URL. Identity is immutable; archive
  and replace instead. Retailer role and branch operation are enforced in
  PostgreSQL.
- `perfume_retailer_observations` are append-only. The latest one is chosen by
  `checked_at`, loaded with a lateral join, and marked stale after 30 days by
  default. There are no commerce actions and no scraping.
- UI: the venue card no longer nests the website link inside the detail link (a
  hydration error). Icons beside text use `CapAligned`. The detail header stacks
  below `sm`. Archived venues show a badge. The "Add Venue" button no longer wraps.

## Completion Notes

- `pnpm typecheck` passes. ESLint on the changed source files passes.
- `pnpm test:local`: 836 tests across 67 files, zero skipped, plus five Python
  checks. New suites: `src/__tests__/integration/venues-retailers.test.ts` (13
  database tests) and `src/__tests__/catalogue/venues-retailers.test.ts`.
- The populated migration rehearsal now seeds a legacy venue with an order. It
  proves the venue survives every expansion migration, and that an invalid legacy
  venue stops 0041 with no partial change.
- Browser (disposable preview database, synthetic data): `/places` grid and list,
  a venue detail page and the create dialog at 390, 768 and 1440px. Desktop and
  tablet: 0 alignment deviations over 0.5px, no overflow. Dialog focus stays
  inside and Escape closes it.
- Limitation: at 390px every list page overflows (`/library` is 1047px wide).
  That is SLN-312, which is still open.
- Limitation: `scripts/qa/alignment-audit.js` skips an icon wrapped in
  `CapAligned` when the text beside it is a bare text node. Measurements here used
  a corrected copy. The script fix is tracked separately.
- Venue pages for collections, exhibitions and retailers remain SLN-370.

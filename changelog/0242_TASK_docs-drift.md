# Task 0242: Docs Drift and a Doc-Coverage Test (SLN-310)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
The docs and `CLAUDE.md` no longer matched the code. This task fixes each item
in SLN-310 and adds a test that fails when a new table or API route has no docs.

## Implementation Details
- `CLAUDE.md`, `docs/00_README.md`: Next.js 16. Ownership is
  `catalogue_status='accessioned'` with at least one active instance.
- `catalogued` and `wishlist` do not exist. `docs/02_DATA_MODEL.md` (example
  query), `docs/05_API_REFERENCE.md` (examples) and
  `docs/09_INGESTION_PIPELINE.md` now use the real values. The ingestion
  derivation matches `scripts/ingest/seed_books.py`.
- `docs/02_DATA_MODEL.md`: `custom_taxonomy_item_works` and
  `custom_taxonomy_item_editions`. `taxonomy_families` and
  `custom_taxonomy_items` were already described.
- `docs/04_ROUTES_AND_VIEWS.md`: no `/tags` or `/subjects`. The route map lists
  every page in `src/app`. New page sections: Reader, Reader View, Places, Place
  Detail, Provenance, Taxonomy, Taxonomy Family, Taxonomy Item. The Series
  section matches the page.
- `docs/05_API_REFERENCE.md`: comments, match, reader, venues and the media
  routes `upload`, `from-url`, `preview-monochrome`, `reprocess`,
  `reprocess-author`, `backfill-palettes`. Write access now says which routes
  check `DURTAL_API_TOKEN`: only the routes that use `src/lib/api/rest.ts`.
- `docs/12_DEVELOPMENT.md`: the broken `01_SPECS.md` link points to
  `02_DATA_MODEL.md` and `01_ARCHITECTURE.md`.
- `src/__tests__/cross-layer/doc-coverage.test.ts`: every `pgTable` name must
  appear in `docs/02_DATA_MODEL.md` and every `src/app/api/**/route.ts` path in
  `docs/05_API_REFERENCE.md`.

## Completion Notes
- `docs/13_CONFIGURATION.md` is left to SLN-309, which owns the environment
  variables and updates that file as part of its fix.
- A probe table and a probe route made the test fail on both; removing them
  made it pass.
- Open PR #18 (SLN-385) adds `/api/image-adjustments.css` with no entry in
  `docs/05_API_REFERENCE.md`, so it fails this test after this merges.

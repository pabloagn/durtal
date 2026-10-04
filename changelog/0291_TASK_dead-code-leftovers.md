# Task 0291: Dead Code Leftovers (SLN-289, SLN-304, SLN-307)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0258
**Blocks**: None

## Overview

SLN-289 (#6), SLN-304 (#31) and SLN-307 (#45) merged this morning. Task 0258 kept some code because open PRs still used it; those PRs have merged since. This task checks each issue against main and removes or merges what is left.

## Implementation Details

Checked on main (726fb3b):

- **SLN-289**: done. The author dialogs set birth and death places through `PlacePicker`, which uses `src/lib/actions/places.ts`; the `places` schema documents the `venue` type. Left: `knip.json` still ignored `places.ts`, which knip now reports as a stale ignore.
- **SLN-304**: done for works, authors, series, the library filters, the work detail query, `parseYear` and the Google Books parsing. Left: `createTaxonomyFamily` (`src/lib/actions/taxonomy-families.ts`) still had its own copy of the slug block (`like(base%)`, then `makeUnique`).
- **SLN-307**: `pnpm deadcode` (knip) runs in `task lint` and reports 0 unused files. Left, from task 0258's kept list, now that the PRs it waited for have merged:
  - `src/components/media/media-gallery.tsx`: no importer (kept for #4).
  - `src/lib/db/backfill-slugs.ts`: a one-off script, in no script or task (kept for #31).
  - `getFilmHolding` in `src/lib/actions/films.ts`: exported from a `"use server"` file, so a callable endpoint, though only the copy writes in the same file call it (kept for the film PRs).

Changes:

- Deleted `media-gallery.tsx` and `backfill-slugs.ts`. `getFilmHolding` is no longer exported: the copy writes still return the saved copy through it, and no request can call it.
- `knip.json`: no `ignore` list any more (both files are settled), and `backfill-slugs.ts` is no longer an entry.
- `createTaxonomyFamily` uses `uniqueSlug` (`src/lib/catalogue/slugs.ts`), whose table type now includes `taxonomyFamilies`.

## Completion Notes

- Open PRs checked before removing anything (`refs/pull/*/head` fetched): none uses `media-gallery`, `backfill-slugs` or `getFilmHolding`, and none edits `taxonomy-families.ts`, `slugs.ts` or `knip.json`. #65 edits `films.ts` 360 lines away from `getFilmHolding`.
- Kept: `getEditionCollections` (`src/lib/actions/collections.ts`), still unused, because open PR #54 changes the lines right above it; it can go after #54 merges. `createSubLocation`, `updateSubLocation` and `deleteSubLocation` stay for their planned UI, as SLN-307 says.
- `pnpm deadcode`: 0 unused files and dependencies, and no stale ignore. `pnpm typecheck`, `pnpm lint` (0 errors), `pnpm build` and `python3 scripts/qa/test-local.py` (1,611 tests in 130 files, 0 skipped): pass. No page changed.

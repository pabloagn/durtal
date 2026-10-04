# Task 0258: Dead Code Removal and a Dead-Code Check (SLN-307)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview
Unimported files, unused server actions and unused dependencies had piled
up. Every exported function in a `"use server"` file is a callable endpoint,
so an unused one is attack surface. Nothing checked for dead code.

## Implementation Details
- Deleted 9 files with no importer: `author-delete-button.tsx`,
  `author-media-section.tsx`, `work-copy-button.tsx`, `work-delete-button.tsx`,
  `work-media-section.tsx`, `hero-background.tsx`, `timeline/index.ts`,
  `timeline/use-timeline-layout.ts` and `ui/table.tsx`.
- Removed 19 unused server actions: `getEdition`, `invalidateLayout`,
  `getLocation`, `getPoster`, `getBackground`, `updateMedia`,
  `updateMediaCrop`, `reorderMedia`, `getSeriesCount`, `getFavoriteVenues`,
  `addEditionToCollection`, and the legacy taxonomy CRUD (`createSubject`,
  `deleteSubject`, `createGenre`, `updateGenre`, `deleteGenre`, `createTag`,
  `updateTag`, `deleteTag`). The family registry in `taxonomy-families.ts`
  does those writes. `getGalleryLayout` is still used inside its file, so it
  is no longer exported.
- Removed the `csv-parse` and `nuqs` dependencies.
- Removed the validation schemas only those actions used: `updateMediaSchema`,
  `createSubjectSchema`, `createGenreSchema`, `updateGenreSchema`,
  `createTagSchema` and `updateTagSchema`.
- Added `knip` (dev dependency), `knip.json`, `pnpm deadcode` and a
  `pnpm deadcode` step in `task lint`. It reports unused files, dependencies
  and unlisted dependencies, and it reports 0 today. The scripts under
  `scripts/` and `src/lib/db/backfill-slugs.ts` are entry points.
- `docs/06_SERVER_ACTIONS.md` no longer lists the removed actions.

## Completion Notes
Kept on purpose:
- `src/lib/actions/places.ts`: open PR #6 imports it and #3 edits it.
- `src/components/media/media-gallery.tsx`: open PR #4 edits it. It has no
  importer, so it can go after #4 merges.
- `src/lib/db/backfill-slugs.ts`: a one-off script that open PR #31 edits.
- `getFilmHolding`: the film PRs (#12, #15, #20) add code next to it.
- `getEditionCollections`: PR #3 edits the lines around it.
- `createSubLocation`, `updateSubLocation`, `deleteSubLocation`,
  `deleteCollection`, `updateVenue`, `deleteVenue` and the custom family
  actions: the UI that calls them is planned (SLN-307 lists them as keep).
- `isbn3` is used by the publisher code, so it stays.
- `@eslint/eslintrc` and `eslint-config-next`: SLN-308 (lint rules) may wire
  them in, so knip ignores them for now. `@types/mapbox-gl`, `tailwindcss`
  and `tsx` are used outside TypeScript imports.
- The dead-code check leaves unused exports out. About 50 helper exports
  remain; they are not server actions.

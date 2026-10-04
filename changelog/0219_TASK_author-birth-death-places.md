# Task 0219: Author Birth and Death Places

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0059
**Blocks**: None

## Overview

SLN-289. Task 0059 promised Birth Place and Death Place fields in the author dialogs. The schema has `authors.birth_place_id` and `authors.death_place_id`, but no screen or action could set them, and the place actions in `src/lib/actions/places.ts` had no caller. So the author map placed every author on a country centroid. This task adds the two fields to the author create and edit dialogs.

## Implementation Details

- `PlacePicker` (`src/components/shared/place-picker.tsx`): a field that:
  - searches saved places as you type (`searchPlaces`);
  - looks a city up worldwide only when you ask (`/api/geocode?mode=search`). Nominatim does not allow lookups on each key press;
  - adds a place by name only, with no coordinates (`createPlace`).
  A picked place shows in a read-only field with a clear button.
- `createPlaceFromGeocode` (`src/lib/actions/places.ts`): stores a geocoding result. It finds or creates the country, region and city chain (`getOrCreatePlaceChain`). A result without a city (a county) is a `district` named by the first part of its display name, so its coordinates never land on the region. Then it fills only the empty full name, country and coordinates of the most specific place. The input is checked with `geocodedPlaceSchema` (`src/lib/validations/places.ts`).
- `createAuthorSchema` accepts `birthPlaceId` and `deathPlaceId`. `getAuthor` returns both places for the edit dialog.
- The author map already uses birth place coordinates before the country centroid (`src/lib/actions/author-map.ts`), so no map change is needed.
- Venue places: `createVenue` writes places with `type = "venue"`. Venue address points stay in `places`, and `venue` is now a documented place type (`src/lib/db/schema/places.ts`, `docs/02_DATA_MODEL.md`).

No migration: the columns already exist.

## Completion Notes

- Checked on a disposable local database (`scripts/qa/preview-local.py`):
  - Edit dialog: Huysmans gets Paris (worldwide search) as birth place and the saved Paris as death place.
  - Create dialog: a test author gets Lyon (city, country FR) and Lyon County, Iowa (`district`).
  - The author map then has points at 48.853, 2.348 (Paris) and 45.758, 4.832 (Lyon), not at country centroids.
- `scripts/qa/alignment-audit.js`: 0 issues on both dialogs, with the picker filled and with its list open. `scripts/qa/design-audit.js`: 0 low-contrast and 0 unnamed elements. The page's one nested control (Export) is not part of this change.
- `pnpm typecheck` and `eslint` clean. `python3 scripts/qa/test-local.py`: 1,489 tests passed.

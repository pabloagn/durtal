# Task 0121: Authors Map — Clicking a Point Should Show That Country's Authors

**Status**: Completed
**Created**: 2026-09-24
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0118, 0120
**Blocks**: None

## Overview

In the authors map view, clicking a map point appears to do nothing. Clicking a country point should open the authors list filtered to that nationality.

## Implementation Details

### Current behavior

- Component: `src/components/authors/authors-map.tsx` (`react-map-gl/mapbox`), loaded from `authors-shell.tsx:30-43`, rendered at ~455-459.
- `handleMapClick` (~117-177): a cluster click zooms in (`getClusterExpansionZoom` + `easeTo`); a single-point click opens a popup linking to `/authors/[slug]`.
- Data (`src/lib/actions/author-map.ts:88-115`): one point per author, at the birthplace coordinates, or at the country centroid when there is none. Points carry no nationality field.
- **Unconfirmed**: why a click "does nothing". Likely cause: many authors stacked on the same country centroid form a cluster that never splits when zoomed, or the popup shows only one author. Reproduce first.

### Fix direction

- Add `nationality` (country name or ISO code, per task 0120) to `AuthorMapPoint` and the GeoJSON properties (`authors-map.tsx:16-24, 105-113`).
- On click of a country-centroid cluster/point, navigate to the nationality filter, reusing `handleFilterChange` logic (`authors-shell.tsx:381-398`). Decide whether to stay in map view or switch to grid/list; the view mode persists in localStorage (`durtal-authors-view-mode`).
- Consider a popup listing the authors at that point, with a "Show all authors from X" link.
- Depends on 0120 (comma country names) and 0118 (an empty result must not unmount the view).

## Completion Notes

Reproduced on a local copy of the live DB: clicking the Hungary cluster zoomed to street level on an empty spot and showed no author.

### Root cause

- No author has birthplace coordinates. All 1,944 mapped authors sit on 71 country centroids, so all authors of one country share one exact point.
- Such a cluster never splits. `getClusterExpansionZoom` returned the max zoom (15) and the map flew there. The points then overlapped, and a click could only reach the top one.
- Second bug found in testing: on the globe projection, Mapbox hit testing misses circles drawn near the horizon. A click on a visible dot at the globe edge found no feature.

### Fix

- `getAuthorsForMap()` adds `nationalityCode` (ISO alpha-2) and `nationalityName` to each point and to the GeoJSON properties.
- New pure helper `src/lib/utils/map-groups.ts`: `leafFromFeature()`, `isSingleSpot()`, `groupMapAuthors()`.
- Cluster click reads its members (`getClusterLeaves`):
  - all on one spot (a country stack): popup with the country, the count, the author list (first 50, "+ N more", links to each author) and "Show all N authors from X";
  - on different spots: zoom in, as before.
- Point click past the cluster zoom takes every overlapping point, so a stack still opens the list.
- Single author popup gets "All authors from X".
- "Show all" / "All authors from": keeps the other filters, sets `nationality=<code>` (task 0120) and switches to grid view.
- Empty map click closes the popup.
- `featuresAtPoint()`: when Mapbox hit testing finds nothing, fall back to the drawn circle whose screen radius contains the click.
- Popup placement: the list popup opens on the side of the point with more room, and the list height is capped so the buttons stay inside the map. On a short map the map pans the point up first. The placement is recomputed on `moveend`; the Popup is keyed on its anchor because it does not apply a changed anchor.
- New helpers in `nationality-param.ts`: `withNationalityFilter()`, `shortCountryName()`.

### Tests

- `src/__tests__/utils/map-groups.test.ts`: 18 tests (grouping, stack detection, feature parsing, links).
- Headless Chromium against a production build on the local DB copy, 13 checks, all pass at 1440x900 and at 1440x620 (map at its 400px minimum): mixed cluster zooms in; US stack (490) at the globe edge, centered and near all four map edges opens a popup fully inside the map; empty click closes; street-zoom stack; single author popup and its country link; "Show all" keeps `gender=female` and lands on the grid with 32 authors (matches SQL); no console errors.
- Note: in `next dev` the first client navigation after a page load sometimes did not commit. The same flows pass every time on the production build, so this is a dev-server quirk, not an app bug.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (243 tests) pass.

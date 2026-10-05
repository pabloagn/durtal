# Task 0335: Library filters by section, with a cover colour filter

**Status**: Completed
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0306 (SLN-449)
**Blocks**: None

## Overview

SLN-405. The library's filters were one short list: no language, year,
copy, taxonomy or colour filters, and no sign of what was chosen outside the
panel. This task gives the library a complete filter set in one panel by
section, a chip for each chosen filter, and a filter by cover colour.

## Implementation Details

- **Cover colours**: `src/lib/color/color-buckets.ts` names the dominant tone
  of a palette with one of 12 colours (red, orange, yellow, green, blue,
  purple, pink, brown, beige, white, grey, black): lightness first, then how
  grey it is, then its hue. Migration `0071_cover_colors` adds
  `editions.cover_palette`, `editions.cover_color_bucket` and
  `media.color_bucket`, each with a check on the 12 names.
- Every palette write stores its colour with it: `mediaPaletteFields` (poster
  upload, a poster made active) and `editionCoverPaletteFields` (the cover
  pipeline: a new book, an edition edit, a metadata match).
  `processAndUploadCover` now reads the palette from the thumbnail and returns
  it with the keys; a failure stores the cover without one.
- **Backfill**: `backfillCoverColors` (`src/lib/color/backfill.ts`) gives
  stored palettes their colour, then reads a palette for each poster and
  edition cover without one, from its thumbnail, each image once. It runs as
  `scripts/maintenance/backfill-cover-colors.ts` (with `--dry-run`) or
  through `POST /api/media/backfill-palettes?limit=N` in batches.
- **Filters**: `src/lib/library/filter-keys.ts` (keys and labels, no zod),
  `filter-params.ts` (`parseBookFilters`, `bookFiltersSchema`) and
  `filter-conditions.ts` (`bookFilterConditions`, `coverColorSql`). The list,
  its count, the timeline and `GET /api/works` share them; the old ad hoc
  parsing in `page.tsx`, the location and poster pre-queries in `works.ts` and
  the timeline's own copy of the conditions are gone. New filters: location
  (several), format, signed and first printing (on one held copy), edition
  language, original language, first published years, series, eight book
  taxonomies (a broader item keeps its narrower ones) and cover colour.
- A book's colour is the colour of the cover its card shows: the active
  poster's, else its first edition's. The card's editions are now ordered
  (oldest first), so the card and the filter read the same edition.
- **Panel**: `FilterDropdown` takes `sections`: a rail of sections with count
  badges and the chosen section's groups beside it, one height for every
  section. Options can carry a count (on the label's baseline) and a swatch.
  The panel moves sideways to stay 16px inside the window and scrolls into
  view; this also keeps the other lists' panels on screen on a phone. The
  options load on the first sign of use (`getLibraryFilterOptions`), with
  their number of books; the page no longer loads publishers and read years
  on every visit.
- **Chips**: `ActiveFilters` shows one chip per chosen value under the bar; a
  click removes it, "Clear all" removes every filter.
- Docs 02, 03, 04, 05 and 07.

## Completion Notes

- Defaults where the ticket left questions open: a cover matches its dominant
  colour only (one colour per cover, so the colour counts add up); beige is a
  colour of its own (cream and tan covers are common); only books for now.
- Tests: `src/__tests__/color/color-buckets.test.ts` (29 named colours, each
  swatch names itself, every colour of a sampled cube has a name),
  `src/__tests__/library/filter-params.test.ts`,
  `src/__tests__/ui/library-filter-panel.test.ts` and the database suite
  `library-filters.test.ts` (each new filter, the poster before the edition,
  list, count, timeline and API in step, option counts, the backfill with a
  broken image, the checks).
- Browser checks in headless Chrome, WebKit and Firefox at 1440 and 390 on a
  preview with covers made for the test and read with the app's own palette
  code (black, cream with a red band, navy, red, green covers named black,
  beige, blue, red, green): no alignment issue, no contrast, name or nesting
  issue; every count on its label's baseline; the panel 16px inside the
  window in all three (Firefox's and WebKit's scrollbars included); a real
  click on a swatch, a chip and Clear all each change the URL and the list.
  The people, places and journal panels stay on screen at 390.
- Page weight: `/library` 93 KB, 81 ms on a quiet run. A second run on the
  loaded Mac put every route over its time budget, the untouched ones too.
- After merge: apply `0071_cover_colors`, then run the backfill (dry run
  first). Until then the colour filter finds no book.

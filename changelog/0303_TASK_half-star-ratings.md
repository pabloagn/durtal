# Task 0303: Half-star ratings across the app

**Status**: Completed
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0302 (SLN-444)
**Blocks**: Reading tracker steps 3 to 15 (SLN-442)

## Overview

Step 2 of 15 of the reading tracker (SLN-442, sub-issue SLN-446). Every work
rating (books, films, perfumes and paintings) shows and edits half stars, 0.5
to 5. Task 0302 already stores half steps. Venue ratings are another scale and
do not change. No migration.

## Implementation Details

- `src/lib/utils/rating.ts`: `formatRating` ("4", "4.5", never "4.0"),
  `HALF_STEPS` and `parseRatingParam` (a URL value kept only when it is a half
  step).
- `src/components/shared/rating.tsx`: `RatingStars` (display; a half star is a
  clipped second icon; empty parts outlined in `fg-secondary`) and
  `RatingInput` (a slider: mouse halves with hover preview and clear on the
  current value; touch whole-star 44px targets, a second tap for the half, a
  drag for half steps, a Clear button; keyboard steps of 0.5). Behaviour
  follows the event's pointer type; sizes follow `pointer-coarse:`. The Clear
  button wraps under the stars where a row is too narrow for both.
- `CapAligned` takes an optional `coarseHeight`, so a box can grow on touch
  and stay on the cap-height center.
- Inputs: the Edit Work and quick edit form (`work-form.tsx`, the rating now
  on its own row, parsed with `Number`), `RatingControl` on film, perfume and
  painting pages (no longer disabled while saving: saves queue, so a quick
  second tap is kept), the bulk toolbar's Rating menu (ten half steps in two
  columns).
- Displays: the book header (stars and "4.5"), `CardRating`, the list badge,
  the table cell, the timeline stars, activity sentences (`formatRating`), the
  CSV export.
- Validation: `RATING_SCHEMA` in `src/lib/validations/helpers.ts` (0.5 to 5,
  multiple of 0.5) for `createWorkSchema`, `updateWorkSchema` and
  `curationPatchSchema`. Venue ratings keep their whole numbers.
- Library: "Min Rating" offers 5, 4.5+, 4+, 3.5+, 3+, parsed as a half step;
  the rating sort puts unrated works last in both directions, and so does the
  dashboard's "Highest rated".
- Every raw SQL read of `works.rating` casts to `float8` or is a sort; the
  curation snapshot is JSON.
- Docs 02, 03 (Ratings; the touch sentence), 04 and 06.

## Completion Notes

- Tests: `src/__tests__/ui/rating-input.test.ts` (9: mouse halves and clear,
  hover preview, touch taps, drag, Clear, every key, ARIA, no `fg-muted`);
  `src/__tests__/utils/rating.test.ts` (5: `formatRating`, `parseRatingParam`,
  the work schemas accept 4.5 and refuse 4.3 and 0, venue ratings stay whole,
  and 3.5 survives an Edit Work save that changes only the notes); the
  validation and curation tests updated for half steps; new database suite
  `half-star-ratings.test.ts` (filter `rating=4.5` returns 4.5 and 5, not 4;
  unrated last in both sort directions; 3.5 kept through an Edit Work save;
  a half star saved on a book and a film; 4.5 returned as a number by the
  film, perfume, painting and publisher lists). `pnpm typecheck` clean;
  `pnpm lint` 0 errors and 81 warnings (one fewer than before); `pnpm deadcode`
  clean; `python3 scripts/qa/test-local.py`: 165 files, 1904 tests, 0 skipped.
- Preview from `live-before-0063-20261005-004058.dump` with half ratings
  seeded on books, a film, perfumes and paintings.
- Page weight before (task 0302 code) and after, same preview: every route the
  same size; `/library` 339 of 300 KB before and after (over budget before
  the change, 0 KB above its baseline); every other route within budget.
- Browsers, Chrome, Firefox 157 and Safari 26 at 1440, 768 and 390 px: the
  book header reads "Rated 4.5 out of 5", no page shows "4.0"; the Edit Work
  slider steps from 4.5 to 4 by keyboard; film, perfume and painting ratings
  set by keyboard and by touch taps (5, then a tap on star 4 gives 4 and a
  second tap 3.5); the bulk menu lists 5 to 0.5. `alignment-audit.js` found
  the header stars 1 px off the number; fixed (the stars are a block flex
  row), then 0. Every other finding is the same on main (Safari's title-row
  icons 0.55 px off, the related carousel arrows at 390 px, decorative cover
  initials under a menu or dialog, the edit dialog's buttons measured against
  the page title behind it, native selects Firefox and Safari count as
  unnamed).
- Touch in Chrome with touch emulation at 390 px: `pointer: coarse`, 44 by 44
  px stars, taps give 3, 2.5, 3, a drag to the left half of star 4 gives 3.5,
  Clear clears and keeps its space. The Clear button first pushed the film
  page to 436 px; it now wraps under the stars (no overflow, no overlap).
- Not run: VoiceOver by hand, and the iOS Simulator. The slider's
  `aria-valuetext` ("Not rated", "4.5 stars") was read in Safari through
  WebDriver.

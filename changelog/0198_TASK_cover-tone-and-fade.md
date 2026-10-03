# Task 0198: Covers load over a tone and fade in

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-394. While a cover loaded, its card showed a black box (`bg-bg-primary`), and then the image appeared at once. Covers take about 1 to 2 seconds through `/api/s3/read`, so every grid opened as rows of black boxes. Now each frame shows a dim version of the cover's own color, and the image fades in over it.

## Implementation Details

- `src/components/shared/fade-image.tsx` (`FadeImage`): an `<img>` that fades in over 150 ms when it loads. An image that is already loaded when the page becomes interactive (server-rendered or cached) stays visible with no fade and no flash: the hidden state is set only after mount, for an image that is not complete. Hover zoom keeps its 300 ms transform transition. No transition under `prefers-reduced-motion`.
- `src/lib/utils/media-style.ts` (`coverToneStyle`): the frame background is the poster's dominant color mixed 40% into `bg-tertiary` (`color-mix(in oklab, …)`), so the tone comes out of the dark instead of a bright block. A frame without a tone uses `bg-tertiary`.
- `src/lib/actions/utils/work-card-query.ts` (`posterTone`): a relational-query extra on the `media` relation that returns only `color_palette->'dominant'->>'hex'`, not the palette. Added to the card queries: `workCardWith` (carousels, series, similar works), `getWorks` (Books), `getLibraryStats` (dashboard books and recent authors), `getAuthors` and `getAuthorBySlug`, `getRecommender`, and the taxonomy item page.
- Book cards (`BookCard`, new `coverTone` prop), author cards (`AuthorCard`, new `photoTone` prop) and the dashboard's recent authors use the tone and `FadeImage`. These were `next/image` with `unoptimized`, so a plain image loses nothing.
- Collection art, series covers and edition covers (`EditionImageBox`) have no palette in their queries: they get `FadeImage` and the `bg-tertiary` frame.

## Completion Notes

Measured on the dev server at 1440x900:

- `/library` at first paint: before, every frame was `rgb(3, 5, 7)` (black). After, no frame is black. 25 of 48 frames show the poster's tone; the other 23 books take their cover from an edition (no palette) and show `bg-tertiary`.
- Fade: 16 covers that loaded after the page was interactive each ran one 150 ms opacity transition. No loaded image stayed hidden on `/library`, the dashboard, `/authors`, an author page, `/collections`, `/series` or a book page.
- Layout shift while covers load: 0.
- `scripts/qa/alignment-audit.js`: no deviations on `/library`, the dashboard, `/authors`, the author page, `/collections`, `/series` and the book page.
- `pnpm typecheck` and eslint on the changed files pass.
- Data: 634 of 634 work posters and 143 of 174 author posters have a palette; 31 author posters and the 9 collection posters have none (`/api/media/backfill-palettes` can fill them).

# Task 0710: Images that fail show their placeholder (SLN-858)

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0707, 0708
**Blocks**: None

## Overview
The Second reviewer's broken-images survey (`findings/broken-images-survey-2026-10-15.md`, main 1304892d) found that almost no image fell back to its placeholder when it failed.
- Most surfaces showed an empty frame or the browser's broken-image mark (an icon, the alt text, or both).
- Book cards recovered only from a failure after hydration. A 404 that came back first, the usual case for a missing object, left them blank for good.
- The film and painting galleries and the collection item thumbs changed size when their images failed.

Now every image that fails shows what no image shows, in the same frame, with no jump.

## Implementation Details
- **`src/components/shared/fade-image.tsx`.**
  - A `fallback` prop is rendered in place of an image that fails. The alt text stays as `sr-only` text for a screen reader. With no fallback, the failed image keeps its frame and is hidden.
  - An image that finished with no width before React listened (a pre-hydration 404) is checked with `decode()`. If decoding fails, an `error` event is dispatched, so `onError` and the fallback run.
  - A new `src` draws the image again.
- **`src/components/shared/cover-cells.tsx` (new).** Several covers side by side, used by the collection and series cards. A failed cover leaves its cell blank, and once every cover has failed the card's placeholder shows. It takes a list of cell classes, not a function, so server components can use it.
- **Fallbacks by surface**, each the same as that surface's no-image state:
  - The title's letter (`CoverLetter`): book cards, including while a cover retries; list, table and Detailed rows; mosaic; the book page cover (`WorkPosterImage` takes `title` and swaps to `WorkPosterPlaceholder`); the edition cover; e-book cards; Statistics covers; reading tiles, journal rows and the reading section; the palette's book thumbs; collection members; series list rows.
  - The name's letter: the collection card and page poster; the place page and the place list. A person's letter: the person page portrait, people list rows and the people table.
  - Initials on their tint: the palette's people thumbs.
  - `CoverFan` / `Monogram`: people cards and the dashboard's Recent people.
  - `TitleCard`: film and painting posters. `Flacon`: perfumes. `PlacePlate`: place cards. `ShelfSpines`: series cards.
  - A blank frame: backdrops (book, collection, person), collage cells (now on the `bg-tertiary` tone), and a lone gallery image. A lone gallery image's frame takes the image's shape from its stored width and height, or 3:2 when those are unknown.
- **Images moved to `FadeImage`:** six `next/image` thumbnails (`unoptimized`, `fill`) and the raw `<img>` surfaces. Each is an absolutely placed `FadeImage` with `loading="lazy"`.
- **Tests:** `src/__tests__/ui/fade-image-fallback.test.ts` covers:
  - the fallback and its `sr-only` alt;
  - no fallback;
  - a new source after a failure;
  - a pre-hydration failure;
  - `CoverCells`, partial and full.
- **Docs:** `docs/03_DESIGN_LANGUAGE.md`, Cards without a photo.

## Completion Notes
Checked on a production build and a local preview database (seed-large 50, reader fixtures). Every edition, film, painting, perfume, person, place and one collection was given an image key that 404s. Two series and two galleries (4 and 3 images) were added, plus a lone gallery image with its size.

- **Image requests forced to fail.** `/api/s3/read` and the reader's cover returned 404 on 26 routes and on the list, Detailed and table views of /library, /series, /places and /people. This ran in Chromium, Firefox and WebKit at 1440 and 390. No visible broken image remained and no page scrolled sideways.
- **No jump.** Every page is the same height whether its images hang (still loading) or fail, in all three browsers. Collage blocks and the lone gallery frame are sized from the layout and stored dimensions, so a loaded gallery is that height too.
- **Layout shift.** Chromium's layout-shift score is 0 on every route but /people at 390 (0.019). That shift comes from a `py-16` block moving 76px at 196ms, before any image answers, so it is not part of this change.
- **Audits.** The alignment audit is clean on all 23 routes at 1440, 1024, 390 and 320 in Chromium, Firefox and WebKit, as is the design audit in Chromium (no low contrast and no unnamed control).
- **Page weight.** Passes, with /library at 290 of 300 KB.

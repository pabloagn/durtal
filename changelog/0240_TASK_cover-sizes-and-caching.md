# Task 0240: Cover Sizes and Cover Caching (SLN-384, SLN-295)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview
The library grid downloaded 800 px covers for cards about 110 to 180 px wide,
about 4 MB per page (SLN-384). Each image also went through a `no-store`
redirect to a signed S3 URL that changed every 30 minutes, so the browser
could not cache it (SLN-295). This task serves the image bytes from the app,
resizes them on request, and lets the browser keep versioned covers.

## Implementation Details
- `src/app/api/s3/read/route.ts`: no redirect. The route reads the object from
  S3 and streams it. `?w=` (240, 400 or 800 only) resizes it with `sharp` to
  WebP at quality 75. A source that is already that narrow is sent as
  stored, with no second compression. Any other width returns 400.
  - With `?v=`: `Cache-Control: public, max-age=31536000, immutable`.
  - Without `?v=`: `private, no-cache` plus the S3 ETag (one per width). The
    browser revalidates, and an unchanged image returns 304 with no body.
- `src/lib/s3/media-url.ts`: `mediaUrl(key, { version, width })`,
  `withMediaWidth(url, w)` and the allowed widths. Client-safe.
- `src/app/library/page.tsx`: grid cover URLs carry a version. An edition
  cover uses `editions.updatedAt` (its key `gold/covers/<id>/thumb.webp` is
  reused when the cover changes; every cover write sets `updatedAt`). A poster
  uses `media.createdAt` (its key holds a new file id per upload).
  `getWorks` selects those two columns.
- `src/components/books/book-card.tsx`: the cover has a `srcSet` of 240, 400
  and 800 px and a `sizes` value, so the browser picks the smallest sharp one.
  New props `coverSizes` and `coverPriority`.
- `src/components/books/book-grid.tsx` and
  `src/components/shared/grid-columns.ts`: `sizes` is the widest card the
  slider value can show over every container width (`maxCardWidth`): 184 px at
  the default 6, 544 px at 2. The first `columns` cards load eagerly with
  `fetchPriority="high"`.
- Other image URLs are unchanged. They now get ETag revalidation from the route
  instead of a redirect.

## Completion Notes
Measured on dev (`next dev`, port 3141) on 2026-10-04: headless Chromium at
1440x900, device pixel ratio 2, `/library` with the default grid (48 cards),
scrolled to the end so every cover loads.

- Before (from SLN-384): about 4 MB of covers, 85 KB each, every one through a
  `no-store` redirect.
- After: 48 covers at `w=400`, 1,344 KB in total, 28 KB each. At quality 80
  the total was 1,612 KB, over the 1.5 MB target, so the route uses 75.
- Reload: 0 KB transferred. All 48 covers come from the browser cache
  (`public, max-age=31536000, immutable`).
- A card is 169 CSS px wide at this viewport, so 400 px is 2.4 device pixels
  per CSS px. At the largest grid size (2 columns, up to 544 px) the browser
  picks `w=800`, which is the stored thumbnail, unchanged.
- The first 6 covers load eagerly with `fetchPriority="high"`.
- Route checks: `w=401` returns 400, a missing key returns 404, a matching
  `If-None-Match` returns 304, an ETag from another width returns 200.
- `alignment-audit.js` on `/library`: 27 checked, 0 issues.
  `design-audit.js`: 0 low-contrast text, 0 unnamed controls.
- Typecheck, lint and `python3 scripts/qa/test-local.py` (109 files, 1497
  tests) pass.

A new cover shows at once because every cover write sets `editions.updatedAt`
(`src/lib/actions/editions.ts`, `src/lib/match/save.ts`, new editions through
`defaultNow`). I checked this in the code, not with a live write.

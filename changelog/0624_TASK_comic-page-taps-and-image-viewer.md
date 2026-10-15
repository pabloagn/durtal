# Task 0624: Comics on a phone: taps turn and show the bars, the viewer shows the page

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

On a phone, any tap on a comic page opened the Image viewer: a tap in an
edge strip did not turn the page, and a tap in the middle did not show the
bars, because a comic's page is an image and a touch on an image was the
viewer's. The viewer then showed only "Failed to fetch" (Chromium) or "Load
failed" (WebKit): it copied the image through `fetch()` of its blob URL, and
the reader's Content-Security-Policy allows images from `blob:` but not
fetching them (`connect-src 'self'`). The same copy failed for images in
EPUBs, on a double click too.

## Implementation Details

- In a book whose pages are images (a comic or another pre-paginated book),
  a tap on a page's image is a tap on the page: an edge strip turns it, the
  middle shows or hides the bars, and a swipe turns. A double tap away from
  the edge strips opens the page in the viewer, as a double click does with
  a mouse. A reflowable book keeps one tap on an image for the viewer.
  - `src/lib/reader/input.ts`: new `pageImages` option; an image is not an
    interactive target when it is set.
  - `src/lib/reader/media/document.ts`: `attachReaderMedia` takes
    `{ pageImages }` and then opens the viewer on a double tap (350 ms,
    30 px) outside the edge strips (`TAP_ZONE`).
  - The foliate engine passes `pageImages` for a pre-paginated book, and
    `reader-view.tsx` passes it to the input layer from `fixedPages()`.

- `src/components/reader/content-viewer.tsx`
  - A book image is shown from its own blob or data URL, which `img-src`
    allows; nothing is fetched. An SVG is still serialized, cleaned and
    shown from a blob URL of its own, revoked when the viewer closes.
  - When an image or table cannot be shown, the viewer says "This image
    could not be opened." (or "This table could not be opened.") in the
    middle of the screen instead of the browser's raw error.
- The reader's policy (`src/lib/reader/csp.ts`) is unchanged.

## Completion Notes

- Comic fixture at 390 on touch, Chromium and WebKit: a right-edge tap turns
  to the next page with no viewer, a middle tap shows the bars with no
  viewer, and a double tap opens the viewer with the page image (480 x 720).
  Firefox at 390 (mouse): a double click shows the image. Before, the edge
  tap opened an empty viewer and the page stayed. Viewer open: 0 alignment
  deviations, 0 low-contrast or unnamed controls, 0 overflow, 0 small touch
  targets; one Escape closes it.
- Tests: `content-viewer.test.ts` (the image is shown from its own blob URL
  with no fetch; a failure says "This image could not be opened.") and
  `page-image-taps.test.ts` (a tap, a double tap, two slow taps and edge
  taps on a comic page; one tap in a reflowable book). Both fail on main.
- No migration and no new packages.

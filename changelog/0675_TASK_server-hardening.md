# Task 0675: Server hardening from the server review

**Status**: Completed
**Created**: 2026-10-16
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-897, SLN-898, SLN-899 and SLN-900, findings 2 to 5 of `findings/server-review-2026-10-16.md`.

- **Framing (SLN-897).** Only the reader's pages said who may frame them (`frame-ancestors 'self'`). A page on another site could frame any catalogue page and lay decoys over it to steer clicks.
- **Broken percent codes (SLN-898).** `/library/%ff`, `/people/%E2%82`, `/zz%ff`, `/api/%ff` and the like answered a bare `500 Internal Server Error`. Next.js cannot decode the path to match the dynamic routes and the `[...missing]` catch-all; it then renders `/400`, which an app with no `pages/` does not have.
- **X-Powered-By (SLN-899).** Every answer sent `X-Powered-By: Next.js`.
- **Place search (SLN-900).** `POST /api/venues/search-places` passed a query of any length on to Google.

## Implementation Details

- `next.config.ts`: `X-Frame-Options: SAMEORIGIN` on every path, and `poweredByHeader: false`. A header rather than a second `Content-Security-Policy`, so it cannot collide with the reader's policy or the PDF worker's. Nothing of Durtal's frames its own pages: the reader's book frames are blob and srcdoc documents, which carry no headers.
- `src/proxy.ts`: an address whose path does not decode answers 400 (JSON, like other API errors) under `/api/` and `/_next/`, before the host check, since nothing runs. A page address is rewritten after the host check, each segment that does not decode escaped as text (`%ff` becomes `%25ff`). The page then looks the text up and shows its own not-found view: "Book not found" with "Back to books", "Person not found", "eBook not found", or the catalogue's "Page not found". The host logic is unchanged.
- Since SLN-896 (#447) the proxy also runs under `/_next/`. The 400 comes before its shortcut for the build's own files, so `/_next/static/%ff` answers 400 too.
- `api/venues/search-places/route.ts`: the query sent to Google is cut to 200 characters, the cap `quickSearch` uses.

## Completion Notes

- **Tests:** new `api/broken-addresses.test.ts` (9 of its 13 checks fail without the fix); `api/search-places.test.ts` checks the 200-character cap.
- **Production preview:** `/library/%ff`, `/library/%E2%82`, `/people/%ff`, `/publishers/%ff`, `/ebooks/%ff`, `/reader/%ff`, `/zz%ff`, `/fonts/%ff` and `/places/%ff?tab=x` answer 404 with their section's not-found view; `/api/%ff`, `/_next/static/%ff` and `/_next/image?url=%ff` answer 400. A POST to `/library/%ff` on another name still gets the host guard's 421. Pages, the reader and API answers carry `X-Frame-Options: SAMEORIGIN` and no `X-Powered-By`.
- **Reader:** three seeded books (EPUB with its section frames, a PDF and a second EPUB) open and show their text in Chromium, Firefox and WebKit, with no framing errors in the console.
- **Audits:** the alignment and design audits found nothing on `/library/%ff`, `/zz%ff`, `/reader/%ff` and `/library` at 1440 and 390 in all three engines.

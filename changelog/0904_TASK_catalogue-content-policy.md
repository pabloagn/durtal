# Task 0904: Catalogue pages run only their own scripts, and every answer sends nosniff and a Referrer-Policy

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0903
**Blocks**: None

## Overview

SLN-1240, ticket 2 of `findings/web-security-survey-2026-10-19.md`.

- Only `/reader/` pages had a Content-Security-Policy, so sanitizing at write
  time was all that kept stored HTML from running. SLN-1239 (0903) showed that
  one missed write was enough.
- No answer sent `X-Content-Type-Options` or `Referrer-Policy`.

## Implementation Details

- **The policy** (`src/lib/page-csp.ts`, `catalogueCsp`). It starts from the
  reader's:
  - `script-src 'self' 'nonce-…'` (with `'unsafe-eval'` only under `next dev`),
    `object-src 'none'`, `base-uri 'none'` and `frame-ancestors 'self'`.
  - Images may come from any https address: the address picker's map tiles
    and markers, and covers found by a lookup. An image can't run script.
  - Styles may also come from unpkg.com, for Leaflet's stylesheet.
  - Connections may also go to Mapbox (the people map) and to the e-book CDN
    when `EBOOK_CDN_URL` is set.
  - `worker-src` and `frame-src` allow `'self'` and `blob:`, for the e-book
    pages' PDF worker and the map's workers.
- **Where it applies** (`src/proxy.ts`):
  - Every page that isn't the reader gets the policy with a fresh nonce, on
    the answer and on the request, where Next.js reads it for its own scripts.
  - A list page still redirects to its saved page size first.
  - API routes keep their own headers.
  - Files of `public/` and the app's icons get no page policy. `sw.js` would
    take it as its own, and the service worker could then no longer fetch a
    map tile or a CDN range for the page.
- **The offline shells**: `/offline` and `/ebooks/offline` render per request
  (`force-dynamic`), as `/reader/offline` already did. A prerendered page has
  no nonce on its scripts. The service worker stores each shell with the
  policy it came with, and the nonce in that policy matches the stored page.
  The not-found page for an unknown address renders per request and carries
  nonces.
- **Every answer** (`next.config.ts`): `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: same-origin`, beside `X-Frame-Options`. That covers pages,
  API routes, the reader, public files and the proxy's own refusals.
- `docs/01_ARCHITECTURE.md` names the policy.

## Completion Notes

- **Real answers** (production build on a private preview):
  - `/`, `/library`, `/offline`, an unknown address and `/library/%ff` carry
    the policy. Every `<script>` on them has the request's nonce.
  - `/api/stats`, `/sw.js` and a refused cross-site API call carry nosniff and
    the Referrer-Policy and no page policy.
- **Browsers**: Chromium, Firefox and WebKit, 144 of 144 checks with no
  violation, from `securitypolicyviolation` events and console messages.
  - The checks cover 44 routes: every list, a detail page of each kind found
    on them, the reading pages, settings, harmonize, provenance, activity,
    e-books, upload, both offline shells and the not-found page.
  - They also cover the command palette, the people map, the address picker's
    map and a book's Cover dialog.
  - In each engine, a script injected into the page is refused and reported,
    so the check itself sees violations.
  - The preview has no Mapbox token. Mapbox's hosts are the ones its
    documentation names for its GL library.
- **Tests**:
  - `api/security-headers` covers the policy's directives and the proxy on
    pages, a POST, the not-found and offline pages, a saved page-size
    redirect, API routes and public files. It also checks nosniff,
    Referrer-Policy and X-Frame-Options on a page, an API route, the reader
    and `sw.js`.
  - The proxy tests that expected no answer for a page now expect it to pass
    on to Next.js, with no refusal or redirect.
  - `pnpm typecheck` and lint are clean, and `pnpm test` passes.
- **Page weight** passes every route. The nonce adds about 34 bytes to each
  script tag, about 2 KB on the dashboard.

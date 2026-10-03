# Task 0183: List pages load once at the saved page size and view

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

A reload of `/library` loaded the list twice. The page size ("Per page") and
the view settings (view mode, grid size, list columns) lived in localStorage,
which the server cannot read. The server rendered the defaults (48 items,
grid, 6 columns). After hydration, the client replaced the URL with the saved
`perPage` (a second full load) and swapped the view (a second layout).

The preferences now live in cookies, so the server renders the saved values
on the first paint. This applies to every list page that uses `Pagination`
or a view-mode switcher.

## Implementation Details

- `src/lib/utils/preference-cookies.ts`: cookie names and the browser read
  and write helpers. A page size cookie is per pathname:
  `durtal-per-page_library` for `/library`.
- `src/proxy.ts` (Next.js 16 proxy, formerly middleware): a GET page request
  without `perPage` and with a valid saved size redirects to the same URL with
  `perPage` set, before anything renders. API routes, `_next` and files are
  not matched.
- `src/lib/hooks/use-preference.tsx`: `usePreference(key, fallback)` replaces
  `useLocalStorage`. The root layout passes the request's `durtal-*` cookies
  to `PreferencesProvider`; the hook uses them for the server render and reads
  `document.cookie` in the browser (`useSyncExternalStore`). Instances with
  the same key stay in sync.
- `Pagination`: the client redirect effect is gone. "Per page" writes the
  cookie and opens the page that holds the first item shown now (page 3 at 24
  becomes page 2 at 48), not page 1. A `perPage` in a shared link no longer
  changes the saved size; only the control does.
- Migration: a value that an older build saved in localStorage moves to its
  cookie once, on the first visit, and the localStorage entry is removed.

## Completion Notes

- Before: `/library` showed 48 items, then a spinner, then 96 items (two
  server renders). A saved grid size of 8 rendered at 6 columns first.
- After: `/library` redirects to `/library?perPage=96` in the proxy and
  renders once. A saved grid size or list view renders on the first paint.
  Sidebar navigation to `/library` follows the same redirect.
- `src/lib/hooks/use-local-storage.ts` is removed; its 14 callers use
  `usePreference`.
- `pnpm typecheck`, eslint and the pagination tests pass. The alignment audit
  on `/library` reports no issues.

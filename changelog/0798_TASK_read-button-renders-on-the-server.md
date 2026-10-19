# Task 0798: The book page's Read button renders on the server

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1065. `components/ebooks/catalogue-read-button.tsx` was a client
component. Through `read-target`, `continue-target` and `conditions` it
reached `medallion.ts`, which imports `node:crypto`, and `keys.ts`, which
reads the server environment. The webpack dev server cannot build
`node:crypto` for the browser, so once a book page compiled every page
answered 500. In a production build the same chain shipped the Node crypto
polyfill and drizzle's `sql` with the book page.

## Implementation Details

- `src/components/ebooks/catalogue-read-button.tsx`: no `"use client"`. It
  has no state, effects or handlers, and its one importer is a server file,
  so it renders on the server; `DropdownMenu` stays a client component and
  takes the trigger and items as rendered elements.
- `src/__tests__/ebooks/client-import-graph.test.ts`: walks the static
  value imports of every `"use client"` module and fails on a `node:`
  built-in or a server-environment import from `@/lib/env` (`publicEnv`
  is allowed). A `"use server"` module ships only references, so the walk
  stops there; a dynamic `import()` is a lazy chunk and is not followed.

## Completion Notes

- Webpack dev preview: with `"use client"` the book page, then `/library`
  and `/ebooks`, answered 500 (`UnhandledSchemeError` on `node:crypto`);
  without it, every page answered 200.
- Production build, book page first-load JavaScript: 2,780 KB raw and
  816 KB gzipped before, 2,290 KB and 667 KB after (149 KB gzipped less);
  no route's first load holds the crypto polyfill chunk now.
- Book page in Chromium, Firefox and WebKit at 1440, 390 and 320, with a
  second e-book edition so the edition menu shows: alignment, contrast and
  unnamed controls 0 with the menu closed and open; Escape closes it and
  the focus returns to its button; no page errors. Page weight within
  budget.

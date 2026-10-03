# Task 0215: Page weight check for the main routes

**Status**: Completed
**Created**: 2026-10-03
**Priority**: LOW
**Type**: Infrastructure
**Depends On**: None
**Blocks**: None

## Overview
Page weight grew and nothing measured it (SLN-386). `/library` went from 322 KB to 816 KB and `/authors` from 914 KB to 1,149 KB in eight days. This task adds a check that prints the HTML bytes and the server time of each main route and fails when a route is over its budget.

## Implementation Details
- `scripts/qa/page-weight.js` requests each route in `scripts/qa/page-weight.json` on `http://localhost:3100` (or the base URL given as the first argument). It prints one line per route and exits with 1 when a route is over budget, does not return HTTP 200, or times out.
- The HTML is requested with `accept-encoding: identity`, so the bytes are the uncompressed HTML. The server time runs until the last byte of the streamed page.
- Each route is requested once before it is measured, so dev-server compilation is not counted.
- A path that ends in `/*` is a detail page. The script takes the first link under that path on the list page: `/library/*` is the first book on `/library`, `/authors/*` the first author on `/authors`. `skip` leaves out static routes such as `/library/import`.
- Budgets are the starting values from the issue: 300 KB for list pages, 400 KB for detail pages, 1,000 ms server time.
- `CLAUDE.md` now says to run the check before a front-end change is called done.

## Completion Notes
Run with `node scripts/qa/page-weight.js`. The budgets must be set again from measured values after SLN-294 and SLN-385 land. Until then `/library` and `/authors` fail by design.

# Task 0396: A deleted item's address answers 404, and stays that way

**Status**: Completed
**Created**: 2026-10-07
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0286
**Blocks**: None

## Overview

SLN-546. The report: the old address of a deleted perfume, film or painting
answers 200 with its not-found view, where a deleted book's answers 404. That
was true when task 0282 noted it, and task 0286 (4 Oct) fixed it: each detail
layout checks the record before the page's loading screen starts the
response. On main (139c339a) every such address answers 404. Two things still
expected the old behaviour or could bring it back unnoticed: the collection
journey's delete step said "a missing record answers 200" and never looked at
the status, and nothing stopped a new loading screen from wrapping a detail
page again. No change to the app.

## Implementation Details

- `src/__tests__/cross-layer/not-found-status.test.ts`: every page under
  `src/app` that calls `notFound()` and sits below a `loading.tsx` needs a
  `layout.tsx` at or above the outermost loading screen that calls
  `notFound()` first. A loading screen wraps its segment and everything below
  it in one Suspense boundary, so a `notFound()` inside it comes after the
  status is sent. The test also checks that it finds the five detail pages it
  guards (films, perfumes, paintings, organizations, publishers) and that it
  flags the two ways back to a 200: a list's `loading.tsx` moved out of its
  `(list)` route group, and a detail layout without its check.
- `scripts/qa/journeys.mjs`: after a perfume, film or painting is deleted, its
  old address must answer 404 before the journey looks for the not-found view.

## Completion Notes

- Statuses on a preview of main (139c339a, large seed) with curl, a Chrome
  user agent and `Accept: text/html`, and as Googlebot: 404 for a deleted
  perfume, film and painting (deleted in the app and with SQL), by slug and by
  id, for GET and HEAD; 200 for the ones still there. The same for a missing address of every other detail
  page: book, person, place, publisher and its edit page, organization,
  series, recommender, collection, taxonomy family and item, reading import
  and reading year. A client navigation's `RSC: 1` request answers 200 for
  every one of them, books included: it carries the not-found view to the
  browser's router and is not a page address.
- Deleted in the app (Actions, Delete) in headless Chrome: the app goes to the
  collection, Back shows "Perfume not found" (or the film's or painting's),
  and a reload, a fresh visit and the id address answer 404.
- The guard test fails, naming the page, with `workRecordExists` taken out of
  the perfume layout and with the films list's `loading.tsx` moved up to
  `films/`; it passes on main.
- `journeys.mjs --disposable` perfumes, films and paintings: all three pass,
  each delete step answering 404.
- The three deleted addresses pass the alignment, design, overflow and touch
  audits in headless Chrome, Firefox and WebKit at 1440, 768 and 390px, each
  answering 404 (27 of 27).
- Typecheck clean; lint 0 errors and 77 warnings as on main; deadcode
  clean; `scripts/qa/test-local.py` 272 files, 3,018 of 3,018 passed.

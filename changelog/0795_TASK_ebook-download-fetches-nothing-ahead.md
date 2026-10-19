# Task 0795: An e-book's Download fetches nothing ahead

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1036. The Download action in an e-book's files table was a Next `<Link>`.
In a production build a Link prefetches its target as soon as it is in view,
and the target here is the file route itself, so opening an e-book page
fetched the whole file before anyone asked for it (four prefetch requests on
the fixture), and a click fetched it again before the browser saved it. On a
large PDF that is hundreds of megabytes the page never needed, and WebKit
could crash on it.

## Implementation Details

- `src/components/ebooks/ebook-files-table.tsx`: Download is a plain `<a>`
  with the `download` attribute and the same href and classes. Replace file
  keeps its Link, since it goes to a page.
- `src/__tests__/ui/ebook-file-actions.test.ts`: checks the plain link, and
  walks `src/` so no `<Link>` points at `/api/ebooks/files/` again.

## Completion Notes

Measured on a local preview in Chromium, Firefox and WebKit. Before: four
`?_rsc=` prefetch GETs to the file route on page load and another GET on
click. After: no request to the file route until the click, and the click
saves the file while the page stays where it was. Typecheck clean, lint 0
errors, page weight within budget, alignment and design audits 0 findings
at 1440, 390 and 320 in three engines.

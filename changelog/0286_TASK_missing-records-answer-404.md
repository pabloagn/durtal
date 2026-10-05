# Task 0286: Missing Records Answer 404

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

The address of a deleted or mistyped film, perfume, painting, organization or publisher showed "not found", but the server answered 200, not 404. A loading screen above the page had already started the response when the page found out that the record was missing, and a status cannot change after that. Bookmarks, link checkers and the journey tests (SLN-379) could not tell a missing record from a real page.

## Implementation Details

- **The list loading screens wrap only the lists.** `films`, `perfumes`, `paintings` and `organizations` each had a `loading.tsx` beside the list page. Next.js wraps everything below a `loading.tsx` in one Suspense boundary, so it also covered the detail pages. Each list page and its loading screen now sit in a route group, `(list)`, which leaves every address the same. The perfume and painting result components moved with their pages.
- **Each detail layout checks the record first.** `films/[slug]`, `perfumes/[slug]`, `paintings/[slug]`, `publishers/[slug]` and the new `organizations/[slug]/layout.tsx` ask whether the record exists before their own loading screen starts, and call `notFound()` when it does not, so the answer is 404. The checks are in `src/lib/catalogue/record-exists.ts`: one small query each, with the same match as the page's lookup (by id or slug, the work's kind and its profile row; a publisher needs its publishing profile). An address that cannot be decoded, or is longer than the lookup accepts, counts as missing. A merged record still redirects first.
- **"Not found" pages moved up one level** (`films/not-found.tsx` and the others), so they also show for a `notFound()` from a detail layout.
- The page still loads its record itself, so a record that exists is read twice per request: once in the small check, once by the page. The page files are changed by open PRs (#56, #58, #63); once those are in, layout and page can share one cached loader.

## Completion Notes

- Statuses with curl on a disposable copy of the live data (one film and one painting added): 404 for a missing film, perfume, painting, organization and publisher, and for a film id that does not exist; 200 for the five lists and for an existing film, perfume, painting, organization and publisher page. Before the change every missing record answered 200.
- In Chrome, Firefox and Safari: each missing address shows its collection's "not found" page ("Film not found"…); each existing page shows its record. The lists hydrate at 1440 and 390px with no error text or sideways scroll.
- Alignment and contrast audit on a missing and an existing film page at 1440, 768 and 390px: 0 issues.
- `pnpm typecheck` clean; `pnpm lint` 0 errors; the full suite 1,786 of 1,786, with `src/__tests__/integration/record-exists.test.ts` (kind, profile row, id or slug, encoded and overlong addresses, publisher profile).
- Page weight: sizes as before; `/library` is over its budget on main too (SLN-381). Server times on the dev preview varied between runs (another thread's preview ran at the same time); the change adds one indexed lookup per detail request.

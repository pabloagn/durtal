# Task 0664: A publisher's book search and the place picker ignore accents

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0663
**Blocks**: None

## Overview

SLN-787 and SLN-788. These are the two searches left that matched only as typed after 0663 (a survey of every search in the app).

- **A publishing house's books** (`/publishers/[slug]`): "a rebours" did not find "À rebours", and "nadas" did not find a book by Péter Nádas.
- **The place picker** (birthplaces, whereabouts and other place fields): "zurich" did not find "Zürich".

## Implementation Details

- `textContains` (`src/lib/actions/utils/text-search.ts`) is 0663's `textMatches`, moved here so the three searches share it. It checks whether a text contains the search either as typed (`ilike`) or with accents, case and punctuation folded on both sides by `search_normalize`. A search of punctuation alone keeps the plain match only.
- **The library list** (`src/lib/actions/works.ts`) uses it unchanged.
- **A publisher's books** (`src/lib/publishers/books.ts`):
  - the work title and the edition title go through `textContains`;
  - an author matches by name through `textContains`, or by every word of the search in any order against the author's folded names (`authors.search_text`, as the library's author search does), so "nadas peter" finds Péter Nádas;
  - the ISBN match is unchanged.
- **The place picker** (`searchPlaces` in `src/lib/actions/places.ts`) matches the place name through `textContains`. It shows the first few matches, so they now come in an order (from the review): the place named exactly so, then the places that contain the search as typed (all that main found), then the others, shortest first. A folded match can no longer push out a place main showed.
- Every match from before stays, because the plain match is kept. No migration and no index.

## Completion Notes

- **Tests:**
  - `integration/publisher-books.test.ts`: "a rebours", "A REBOURS", an edition title ("la bas" finds the edition titled "Là-bas"), "nadas", "peter nadas", "nadas peter", "joris karl"; "100%" and "%" still find "100% Pure" as typed, and "—" finds nothing.
  - `integration/domain-search.test.ts`: the place picker finds "Zürich" by "zurich" and "Zürich", "Bogotá" by "BOGOTA", "Saint-Étienne" by "saint etienne", and nothing for "%". A second case (from the review) checks that its first eight keep every place the search as typed finds, with the exact name first.
  - Run against main's code, both new tests fail at their first accent-free search.
- `pnpm typecheck` is clean, and ESLint on the changed files is clean. The publisher page and domain search database suites pass (8 tests each).

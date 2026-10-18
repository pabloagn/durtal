# Task 0910: Accented names make no duplicates

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1015, from section 1 (items 2-4) and the place lookup note of
`findings/search-survey-2026-10-18.md`. Three places matched names by case
only, so a name typed without its accents made a second record:

- Add to collection: "decadents" hid "Décadents" from the list, and
  "Create & add" made a second "Décadents".
- The record pickers (people, organizations and venues in the film, perfume
  and painting forms, and record fields) offered Create "Emile Zola" beside
  "Émile Zola".
- A geocoded "Zurich" added a place beside an existing "Zürich".

## Implementation Details

- `add-to-collection-dialog.tsx`: the list filter and the Add or
  "Create & add" choice compare names through `normalizeSearchText`
  (accents, case and punctuation aside), as the book form's author match does.
- `search-picker.tsx`: the Create offer is hidden when a result has the
  typed name once both are normalized.
- `places.ts`, `getOrCreatePlaceChain`: a place is reused when
  `search_normalize(name)` matches, with the same type and parent as before;
  where both spellings exist, the one as given comes first.

## Completion Notes

- New `src/__tests__/ui/accent-duplicates.test.ts` (4 cases) and a geocoding
  case in `src/__tests__/integration/domain-search.test.ts`, run against a
  disposable PostgreSQL 16.

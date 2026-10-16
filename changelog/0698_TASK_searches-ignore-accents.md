# Task 0698: Every search ignores accents, and the taxonomy filter keeps typed letters

**Status**: Completed
**Created**: 2026-10-16
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-881, from sections 1 and 2 of the search survey
(`findings/search-survey-2026-10-16.md`). Every list page that searches on
the server already ignored accents and case. Nine other searches did not:
"DECADENTISME" missed "Décadentisme", "a rebours" missed "À rebours" and
"cote" missed "Côte d'Ivoire". The worst was the taxonomy item filter, which
also lost typed letters. Its field showed the URL, which changed only once
the server had answered, so a key typed in the meantime went into stale text.
With the live database's latency, "seed film" came out as "se im".

## Implementation Details

- **The taxonomy item filter**
  (`taxonomy/[familySlug]/taxonomy-family-shell.tsx`):
  - The field keeps its own text, and the list is filtered in the browser
    with no server request.
  - The URL follows 300 ms after the last key, through
    `history.replaceState`, which `useSearchParams` follows. That URL coming
    back never overwrites letters typed since. A URL changed from elsewhere
    (back, forward) still sets the field.
  - No match shows the shared `NoResults`, with Clear search. Clear search
    empties the field in place and leaves focus in it.
- **Client filters** use `searchScore` / `filterBySearch`
  (`src/lib/utils/search-text.ts`), which mirror `search_normalize()`:
  - the Filter panel's searches (`filter-dropdown.tsx`);
  - the taxonomy Merge dialog (`merge-dialog.tsx`);
  - the record forms' long tag lists (`multi-select-section.tsx`);
  - a film's countries and languages (`useListSearch` in
    `film-fields.tsx`), still with starts of words first.
- **Server searches** use `textContains`
  (`actions/utils/text-search.ts`). It keeps every plain match and adds the
  folded one.
  - Collections (`collectionListCondition`).
  - Add to collection: the edition and work titles, matching how authors
    already matched.
  - New order: find a book (`searchWorksForOrder`).
- **The library timeline** searches as the library's lists do: title,
  authors, series, publishers and ISBN. The lists' condition moved
  unchanged out of `actions/works.ts` (a server-action file can export only
  actions) into `src/lib/library/search-condition.ts`, as
  `workSearchCondition`. The list and the timeline both use it.
- `NoResults` (`shared/no-results.tsx`) takes an optional `onClear`, for a
  list that clears in place.

## Completion Notes

Tests added:
- `taxonomy-filter.test.ts` (UI) covers four cases:
  - accents and case are ignored;
  - every letter is kept with no server request, and the URL follows after
    the pause without overwriting what was typed since;
  - a URL changed from elsewhere wins;
  - no match shows Clear search, which clears in place and keeps focus.
- `filter-dropdown.test.ts`: "ERIC", "agnés" and "jean luc" each find their
  option.
- `film-list-search.test.ts`: "cote" finds "Côte d'Ivoire", with starts of
  words first.
- Integration tests:
  - Collections: "DECADENTS", "décadents" and "Óther".
  - Add to collection: "A REBOURS".
  - New order: "A REBOURS" and "la bas".
  - The timeline: by accent-free title, by author ("huysmans" finds the book
    by Huÿsmans) and by series.

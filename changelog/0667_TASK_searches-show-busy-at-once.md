# Task 0667: The Books, publisher and place searches show they are working at once

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0661
**Blocks**: None

## Overview

SLN-806, with SLN-819. These were found in the reviews of 0663 and 0664 (`findings/review-pr-367.md`, `findings/review-pr-374.md`). People and eBooks show their wait from the first key of a search (0661). Three searches did not:

- **Books:** the wait showed only when the typing pause ended, about 550 ms after the first key, because its filters were not inside a `ListPendingProvider`. While someone kept typing, nothing showed.
- **A publishing house's books:** no wait at all; the old books stayed until the new ones replaced them.
- **The place picker:** its spinner started about 450 ms after the first key, when the typing pause ended. An older answer that arrived late could also replace a newer one (SLN-819).

## Implementation Details

- `library/(list)/page.tsx`: `ListPendingProvider` goes around the filters and the books, and the books go in `ListPendingSwap`, as on People. The search, the sorts and the filters in `EntityFilters` already go through the provider when there is one.
- `library/filters.tsx`: removing a filter chip and "Clear all" now go through the list's navigation too, so they keep the wait up until the new books arrive.
- The loading screen is unchanged: the books' own wait is the same `ListPending`, so the client's wait and the server's are one mark in one place.
- `publishers/[slug]/page.tsx` and `components/publishers/publisher-books.tsx`: the same provider goes around the house's book filters and its books (or its no-results state). The search, sorts, filters, the year range and "Clear all" go through it.
- `components/shared/place-picker.tsx`:
  - the spinner shows from the first key and stays until the newest search's answer is in; it is now the shared `Spinner`, as in the lists;
  - each search is numbered, and an answer to an older one is dropped, for the city list and for "Search worldwide" alike (SLN-819).
- No migration and no new package.

## Completion Notes

- **Tests:**
  - `ui/library-busy.test.ts`: a key shows the wait before the typing pause ends and hides the books; a sort shows it and the books come back when the navigation is done; removing a filter keeps the wait up, with the old books hidden underneath, until the new ones arrive. The last check fails with main's `filters.tsx`.
  - `ui/place-picker-busy.test.ts`: the spinner shows from the first key until the answer; an older answer arriving after a newer key is dropped; the spinner stays while a newer search is on its way. All three fail with main's picker.
- **Timing** on the seeded production preview, every database round trip held at 800 ms by the preview bridge (audit-only, not committed). "seed" was typed at 60 ms a key; each time is from the first key.

  | | Busy mark, main | Busy mark, this change | Results, main | Results, this change |
  | --- | --- | --- | --- | --- |
  | Chromium | 543 ms | 14 ms | 3,016 ms | 3,018 ms |
  | Firefox | 572 ms | 22 ms | 3,057 ms | 3,060 ms |
  | WebKit | 556 ms | 16 ms | 3,060 ms | 3,043 ms |

- **The publisher page and the place picker**, same setup ("the" in Penguin Modern Classics' book search, "par" in the edit page's "Founded in"):

  | | Publisher page, main | This change | Place picker, main | This change |
  | --- | --- | --- | --- | --- |
  | Chromium | none | 14 ms | 446 ms | 17 ms |
  | Firefox | none | 13 ms | 460 ms | 16 ms |
  | WebKit | none | 17 ms | 460 ms | 15 ms |

  The wait stays up without a gap until the results arrive, and the field keeps its focus.
- **Browser checks** in Chromium, Firefox and WebKit, at 400 ms a round trip: the search field keeps focus through the results; a sort chip shows the wait 8 to 17 ms after the click; a key after the results makes the list busy again.
- **Audits:** the alignment and design audits found nothing on `/library`, `/library?q=seed`, a publishing house's page and its edit page at 1440 and 390, in all three engines.
- **Page weight:** every route is within budget (`/library` 189 of 300 KB).
- `pnpm typecheck` is clean, and ESLint on the changed files is clean.

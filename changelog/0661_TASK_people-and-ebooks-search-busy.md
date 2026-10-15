# Task 0661: People and eBooks searches show they are working at once

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0660
**Blocks**: None

## Overview

SLN-753. This was finding 5 of the second loading and speed audit (`findings/audit-loading-2-2026-10-15.md`).

- **People:** typing a search showed nothing for about 1.2 s. Then the address changed and the busy mark appeared.
- **eBooks:** nothing changed for 1.1 to 1.3 s, then the results appeared. There was no busy mark at all.

## Implementation Details

- `src/components/shared/list-pending.tsx`:
  - `ListPending` is the list's wait. The books list's loading screen and its own wait use it, and so does every search below (`LibraryPending` is now this one).
  - `ListPendingProvider` goes around a list's filters and its results. The results go in `ListPendingSwap`.
  - From the first key of a search (`begin`), or from a sort or filter, the results are swapped for the list's wait. The swap lasts until the new results are in: the navigation runs in a transition (`navigate`), and the list stays busy while that transition is pending.
  - The old results stay mounted underneath, hidden, so they keep their state.
  - Outside a provider, `useListNavigate` navigates as before. So the other lists that use `EntityFilters` do not change.
- **People** (`people/page.tsx`, `authors-filters-bar.tsx`):
  - The provider goes around the toolbar and the results.
  - The search, the sorts and every filter go through it.
  - The results' own wait is now `ListPending` too, so the client's wait and the server's are the same mark in the same place.
- **eBooks** (`ebooks/page.tsx`, `ebooks-view.tsx`, `ebooks-filters.tsx`):
  - The provider goes around the list.
  - The search, the sort buttons, the table's sort headers and the filters go through it.
  - The counts and Continue reading stay in view.
- No migration and no new package.

## Completion Notes

- **Test:** `ui/list-pending.test.ts` checks that:
  - a key shows the wait at once, and the old results stay mounted and hidden;
  - the list stays busy while the new results are on their way, and shows them once they arrive;
  - outside a provider, a navigation runs as before.
- **Timing** was measured on the seeded production preview, with every database round trip held at 800 ms by the preview bridge (audit-only, not committed). A search was typed at 60 ms a key, and each time is from the first key.

  | | People: busy mark | People: results | eBooks: busy mark | eBooks: results |
  | --- | --- | --- | --- | --- |
  | Before, Chromium | 1,224 ms | 2,037 ms | none | 1,161 ms |
  | Before, Firefox | 1,243 ms | 2,048 ms | none | 1,188 ms |
  | Before, WebKit | 1,231 ms | 2,064 ms | none | 1,170 ms |
  | After, Chromium | 19 ms | 2,055 ms | 19 ms | 1,161 ms |
  | After, Firefox | 17 ms | 2,065 ms | 29 ms | 1,241 ms |
  | After, WebKit | 27 ms | 2,079 ms | 34 ms | 1,193 ms |

  - The results are the same in every browser (3 people for "an", 16 eBooks for "the").
  - On People, the client's wait and the server's are one mark in one place: it stays up without a gap until the results arrive.
- **Browser checks** in Chromium, Firefox and WebKit:
  - The search field keeps focus while the results load, and a second key after them makes the list busy again.
  - A sort (Recent on People, Added on eBooks) shows the wait at once.
- **Audits:** the alignment and design audits found nothing on People, eBooks and Books at 1440 and 390, in all three engines.
- **Page weight:** every route is within budget (`/ebooks` 214 of 250 KB).
- `pnpm typecheck` is clean. ESLint adds no warning on the changed files; the one left in `ebooks-filters.tsx` was there before.


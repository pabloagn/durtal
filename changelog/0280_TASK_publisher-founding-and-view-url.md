# Task 0280: Publisher Founding Year, City and View in the URL (SLN-427 leftovers)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0231 (SLN-427 publisher pages), 0254 (SLN-426 favourites)
**Blocks**: None

## Overview
SLN-427 shipped without three things its issue asked for: the house's
founding year and city, a Favourite filter on its books, and every view
choice in the URL. This task adds the first and the last; the Favourite
filter comes with SLN-426 (task 0254), which this branch builds on.

## Implementation Details
- Migration `0062_publisher_founding` (drizzle-kit, after 0254's `0061`):
  `publishing_houses.founded_year` (SMALLINT, 1000 to 2100, check
  `publisher_founded_year_check`) and `founded_place_id` (FK to `places`,
  ON DELETE SET NULL). Additive: no existing row changes.
- `publisherSchema` validates both; `savePublisher` writes them;
  `getPublisher` returns `foundedPlace` (id, name, full name).
- Edit and add forms (`publisher-editor.tsx`): a year field and the shared
  `PlacePicker` for the city, as in the author dialogs.
- Publisher page: the header facts read "Founded 1936 in New York"; the
  record column shows Founded and Founded in.
- The books' grid or list view (`?view=`) and the grid's columns (`?cols=`)
  are kept in the URL: a shared link opens the same view; without them, the
  last choice made on the device. A choice updates both, through
  `history.replaceState`, so switching is instant (no server render). Neither
  counts as a filter: a search with no match offers "Clear search" only.
- Docs: `02_DATA_MODEL.md` (columns), `04_ROUTES_AND_VIEWS.md` (publisher
  page).
- Test: `publishers.test.ts` saves, reads and clears both fields and rejects
  a bad year and a bad place id.

## Completion Notes
Checked on a disposable local database with a house founded in 1936 in New
York and 6 books: the header reads "Founded 1936 in New York" and the record
shows Founded and Founded in; the edit form saves 1950 and New York; Grid ↔
List and the column slider change the URL with no request to the server;
`?view=grid&cols=3&q=zzzz` shows "No books found" with "Clear search" only.
Alignment and design audits on the publisher page and the edit form at 1440,
768 and 390px: no deviation over 0.5px, 0 unnamed and 0 nested controls, no
sideways scroll (the only low-contrast texts are the cover placeholders'
letters, unchanged).

Migration 0062 is not applied to the live database here. Its number follows
0254's 0061; both were regenerated on main after 0060.

# Task 0887: A location is never deleted with what it holds

**Status**: Completed
**Created**: 2026-10-18
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Deleting a location deleted the book copies kept there (the `instances.location_id` reference cascades), while film copies, paintings and perfume bottles blocked it. Now anything held, book copies included, blocks the delete: the dialog names what the location holds and says to move it first, and the server refuses the same way. A book copy form also offered every location for every format, so a paperback could be saved in a digital location; it now lists places the way the film copy form does (SLN-1060).

## Implementation Details

- `deleteLocation` (`src/lib/actions/locations.ts`) reads the location's holdings and refuses with an `ExpectedActionError` naming them ("Study holds 3 book copies and 1 film copy. Move them to another location first."). The delete transaction locks the location row first, so a copy, film, painting or bottle saved meanwhile waits on that lock and then fails its reference check, and asserts all four tables are empty before deleting. No migration: the cascade stays in the schema but no code path reaches it. The e-book lock and retry the cascade needed are gone, as no copy can be deleted here.
- `getLocationItemCounts` shares one counting query with the delete (`locationItemCounts(where)`).
- `deleteLocation` crosses to the page through `catalogue-ui.ts` / `catalogue-client.ts`, so a refusal the card did not foresee (a copy saved in another tab) shows its reason in the toast instead of "Failed to delete location".
- The location card's delete dialog blocks on any held item and drops "This cannot be undone." while blocked; its Delete uses the `danger` button.
- The book copy form (`src/components/books/instance-form.tsx`) puts Format and Condition above Location, as the film form puts the medium above its place. Hardcover and paperback list physical locations, eBook, PDF and EPUB digital ones; an audiobook or Other may be kept in either. Choosing a format the current location cannot hold clears the location; a location the copy already has stays listed, so a saved place never reads as empty.
- `docs/04_ROUTES_AND_VIEWS.md`, Locations, says so.

## Completion Notes

- Tests: `location-copies.test.ts` now expects a location with one book copy to be refused with its reason, an emptied one to delete, and the refusal to cross `catalogue-ui` as `{ ok: false, error }`; `reading.test.ts` moves the copy out before deleting its place. New `copy-form-locations.test.ts`: the places listed for each format, a saved place kept, and a place cleared when the format cannot be kept there. Targeted run: 9 files, 125 tests passed; UI and library suites 184 files, 1,099 tests passed.
- Headless Chromium, Firefox and WebKit at 1440 (mouse), 390 and 320 (touch), on a production build with a disposable database: Study, holding one copy, shows "Study holds 1 book copy. Move it to another location before deleting it." with Delete disabled, and Escape (key code 27) closes it; a copy saved after the Cellar dialog opened makes Delete show "Cellar holds 1 book copy. Move it to another location first." in the toast and keeps Cellar; a new empty location deletes. In the copy form Format comes before Location, Paperback lists only physical places, and EPUB lists only digital ones and clears Study. No dialog scrolls sideways.
- Alignment, design and touch audits inside both dialogs: no findings at any width. Browser audit on `/locations` and a book page: 18 of 18 loads pass. Page weight: every route passes.

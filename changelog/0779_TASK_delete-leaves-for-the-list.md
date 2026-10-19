# Task 0779: A delete from a record's page goes straight to its list

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-1141 (task 0772)
**Blocks**: None

## Overview

SLN-1330. Deleting a record from its own page ran the delete, which
re-rendered that page on the server, now with the record gone, so the action
answered with a not-found page. The client then pushed to the list, and most
handlers refreshed after the push, rendering the list twice. In `next dev`,
with task 0772, a collection delete showed "Page not found" for about a
second before the list (findings/delete-flows.md). Back then returned to the
deleted page, which said "Page not found".

Now the delete action redirects to the list, so its one response renders the
list, and the deleted page leaves the history.

## Implementation Details

- `src/lib/actions/catalogue-ui.ts`: `deleteThenLeave(to, run, stay)` wraps a
  delete in `actionResult`. On success it calls
  `redirect(to, RedirectType.replace)`. A refusal comes back as data, and the
  page stays with its reason. So does an outcome the page must still report
  (`stay`): image files left to clean up after a collection, film, painting
  or perfume.
- Ten adapters use it: `deleteCollectionFromPage`, `deleteFilmFromPage`,
  `deleteWorkFromPage`, `removeOrganizationFromPage`,
  `deletePaintingFromPage`, `deleteAuthorFromPage`, `deletePerfumeFromPage`,
  `removeVenueFromPage`, `deleteRecommenderFromPage` and
  `deleteSeriesFromPage`. The plain adapters stay for the lists, bulk
  toolbars and card menus, which delete without leaving.
- `src/lib/actions/catalogue-client.ts`: `leaving()` reads Next's redirect as
  done (null), since the router follows it with the response it already has.
  Anything else is unwrapped as before.
- The ten record pages call these, show their toast, and push only when they
  stayed. Their `router.push` and `router.refresh` after a delete are gone.
- `router.refresh()` right after a navigation is gone: new collection,
  new taxonomy family, a saved publisher, a deleted taxonomy family. The
  formulation delete refreshes only when it doesn't navigate.
- `src/__tests__/ui/delete-leaves-page.test.ts`:
  - the redirect, with history replaced;
  - a refusal and an outcome to report both stay;
  - the client reads the redirect as done;
  - no `router.push` or `router.replace` in `src/` is followed by
    `router.refresh()`;
  - each of the ten pages deletes through its `FromPage` adapter.
- `refusals-reach-the-screen.test.ts` accepts `deleteThenLeave` as a wrapper
  that calls `actionResult`.

## Completion Notes

- Production preview, headless browsers at 1440. Each run timed from the
  confirm click to the list's heading:
  - collection and series: 3 runs each in Chromium, Firefox and WebKit, 0.36-0.70 s;
  - recommender, film, painting, organization, venue, person and book: one
    each in all three browsers, and perfume in Chromium and WebKit (Firefox's
    two perfumes had records blocking Delete), 0.36-0.90 s.
- In every run a MutationObserver saw no "not found" heading at any point,
  the deleted record was gone from the list, and the toast showed. Back
  didn't return to the deleted page.
- A refused film delete (the id swapped for an unknown one in the request)
  stayed on the film with "Film not found" in all three browsers.
- The flash on main: on a production build of main 4a63a05b (with task 0772),
  the same observer saw no not-found heading in 10 runs: collection ×3,
  series ×3 and a film in Chromium, and a book in each of the three browsers.
  Those deletes landed in 0.38-0.70 s too. The flash the delete-flows survey
  measured was in `next dev`. In production the change still removes the
  deleted page's server render and the second render of the list. It also
  keeps the deleted page out of Back, which on main returned to it.
- Not changed: deleting a taxonomy family still navigates from its dialog
  (`DeleteFamilyDialog`), a Taxonomy pages file. Only its refresh after the
  navigation went.
- `pnpm typecheck`, ESLint (no errors) and `pnpm test` pass. Page weight
  passes.

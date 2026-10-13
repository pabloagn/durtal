# Task 0466: Locations count every kind of item, and say what a delete does

**Status**: Completed
**Created**: 2026-10-13
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0462
**Blocks**: None

## Overview

Found in the review of task 0462. A location card's "N items" counted book
copies only, so film copies, paintings and perfume bottles kept there did not
show. Its delete dialog said deleting "will remove the location reference
from those items". That was wrong both ways: book copies are deleted with
their location (`instances.location_id` cascades), and a film copy, painting
or bottle there makes the database refuse the delete (their `location_id`
restricts). That ended in a bare "Failed to delete location".

## Implementation Details

- `getLocationItemCounts()` (`src/lib/actions/locations.ts`) replaces
  `getLocationCopyCounts()`: one live query (four grouped counts in a
  `union all`) gives each location its book copies, film copies
  (`film_holdings`), paintings (`art_objects`, held ones only, as only they
  carry a location) and perfume bottles. It stays uncached, as in 0462.
- `src/lib/catalogue/location-items.ts`: the counts type, the total and
  `describeLocationItems` ("3 book copies, 1 film copy and 2 perfume
  bottles").
- The card's "N items" is the total of every kind. In the delete dialog:
  - With film copies, paintings or bottles there, the dialog names them,
    says to move them to another location first, and Delete is off.
  - Otherwise, with book copies, it says they are deleted with the
    location.
- `docs/04_ROUTES_AND_VIEWS.md`, Locations: the count and the delete.

## Completion Notes

- `location-copies.test.ts`:
  - Two film copies, a painting and a bottle count beside a book copy, and a
    bottle moved shows on the next read while the cached locations list
    stays warm.
  - A location holding them refuses the delete and keeps everything; one
    with only book copies is deleted with them.
- New `src/__tests__/catalogue/location-items.test.ts`: totals and wording.

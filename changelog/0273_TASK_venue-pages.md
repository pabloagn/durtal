# Task 0273: Venue Pages Around Collections, Loans and Retailers (SLN-370)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: SLN-351 (venue relationships), SLN-360 (whereabouts), SLN-357 (retailers), SLN-364, SLN-361
**Blocks**: SLN-379, SLN-380, SLN-381

## Overview
A venue page now shows what the venue is around: who runs or owns it and its
other branches, the art recorded there now apart from what its institutions
own elsewhere, the perfumes sold there with dated offers, and the orders
placed there. Venues can be edited, archived, restored, and deleted only when
nothing refers to them. The places list gains country and archived filters.

## Implementation Details

**No schema change.** Institutions are `organization_venues`; art is
`art_objects` and `art_object_whereabouts`; listings are
`perfume_retailer_links` with `perfume_retailer_observations`; orders are
`orders.venue_id`.

**Services** (`src/lib/actions/venue-pages.ts`):
- `getVenueInstitutions`: each institution with its relation (runs, owns),
  roles and other venues.
- `getVenueArt`: `here` is every open location record at the venue, any
  certainty, with owner, custody, occasion, start date (`catalogueDateText`),
  display state, certainty and source as recorded; `away` is what the venue's
  institutions own whose current place (the confirmed open record, else the
  latest open one) is not this venue, or is not recorded. Up to 100 rows each,
  with full counts.
- `getVenueRetail`: listings for this branch, then the operator's listings
  with no branch (online), each with its formulation and last observation
  (`retailerObservationAge`).
- `getVenueOrders`: orders at the venue, newest first (50), with the count.
- `getVenueReferences`: everything that refers to the venue, counted, for the
  delete dialog.
- `removeVenue`, `setVenueArchived`, `linkVenueInstitution`,
  `unlinkVenueInstitution`: the existing writes with readable messages.
- `getVenueCountries`: countries reached through a venue's place or the
  places above it. `getVenues` takes `countryIds` with the same rule.

**Screens**:
- `/places/[slug]`: actions menu (`venue-actions.tsx`: Edit, Archive or
  Restore, Delete with blockers); About; Institution
  (`venue-institutions.tsx`, with "Link an institution"); Here now, Its
  collection elsewhere, Perfumes sold here and Orders (`venue-parts.tsx`);
  then specialties, tags and notes. Dialogs render at the end of the page,
  outside the title row.
- The venue dialog (`venue-create-dialog.tsx`) also edits, and gains rating,
  favorite and visit dates. A Google place chosen while editing replaces the
  point; otherwise the address stays. Manual entry never needs Google.
- `/places`: country and archived filters; archived venues are marked on
  cards and rows.
- `AVAILABILITY_LABELS` moved to `src/lib/catalogue/retailers.ts`, shared by
  the perfume page and the venue page.
- `PlacePlate` (a venue card with no image) tints at 10%, the strongest tint
  that keeps its `fg-secondary` label above 4.5:1; the gallery tone measured
  4.41:1 at 12%.
- `page-weight.json` gains `/places` and `/places/*`.

**Limits**: institution names are plain text until the organization pages
(SLN-369, PR #61) are on main. A venue with no place, or a bare map point from
a Google lookup, has no country, so the country filter cannot reach it.

## Completion Notes
- Tests: `integration/venue-pages.test.ts` (database: a museum whose original
  is lent to a gallery, here and away on both pages with dates, owner and
  display as recorded, an unplaced object, branches; an online retailer with
  no address, a branch listing with a dated offer and an online listing, the
  guard that keeps a retailer on its branch; a bookshop's orders, refused
  delete, archive and restore, edits; a venue's country through its places).
- Checks: `pnpm typecheck` clean; `pnpm lint` has no errors and no new
  warnings; `python3 scripts/qa/test-local.py` passes every suite (131 files,
  1,615 tests).
- Browser (headless Chrome, own profile) on `preview-local.py --from-dump` of
  the 2026-10-04 11:37 backup (49 venues), seeded with the Louvre (two
  museums, one painting lent to a Tokyo gallery, one in storage, one with no
  recorded place) and an online perfume retailer with two listings. Audits at
  1440 and 390px on the places list (all, archived, museums and galleries),
  the museum, the gallery, the online retailer, a shop with 86 orders, the
  edit, delete and link dialogs and a perfume page: no deviation over 0.5px,
  no text under 4.5:1, no unnamed or nested control, no overflow, no console
  error, after two fixes (the remove button beside an institution's name sat
  0.88px off; the gallery plate label was 4.41:1).
- Flows: edited a museum's name and specialties; archived it (hidden from the
  list, shown with `archived=include`) and restored it; linked a new
  institution created from the search (it gets the gallery role); removing a
  retailer from its branch with listings shows "Retailer listing history
  still references this operated branch"; Delete on the shop lists 86 orders
  and stays off; an unused venue deletes and the page returns to the list.
- `page-weight.js`: `/places` 187 KB in 76 ms, `/places/*` 53 KB; the museum
  page 56 KB, the shop with orders 97 KB. Every other route is within budget
  except `/library` (313 KB), which this task does not change. A toast's icon
  sits 10px off its text, as on main.

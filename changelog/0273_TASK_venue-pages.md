# Task 0273: Venue Pages Around Collections, Loans and Retailers (SLN-370)

**Status**: In Progress
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

**Limits**: institution names are plain text until the organization pages
(SLN-369, PR #61) are on main. A venue with no place, or a bare map point from
a Google lookup, has no country, so the country filter cannot reach it.

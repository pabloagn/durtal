# Task 0272: Shared Organization Directory (SLN-369)

**Status**: In Progress
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: SLN-350 (shared organizations), SLN-364, SLN-361, 0202 (perfumes), 0213 (films), paintings
**Blocks**: SLN-379, SLN-380, SLN-381

## Overview
One directory for the organizations of every collection: publishing groups,
publishers and imprints, perfume houses, brands and manufacturers, retailers,
production companies and distributors, museums and galleries. Each
organization has a page that keeps its parts apart: its publisher profile, its
perfume roles, its films, its paintings and its venues. Publisher URLs, slugs
and the book profile do not change.

The people half of SLN-369 moved to SLN-419 (People, at `/people`) and SLN-420
(role indicators on person cards); this task does not touch the author pages.

## Implementation Details

**No schema change.** An organization is the `publishing_houses` row; roles
outside publishing are `organization_roles`; the group, publisher and imprint
levels stay on the row (`kind`, `parent_id`).

**Words** (`src/lib/catalogue/organizations.ts`): `DIRECTORY_ROLES` (a
publishing group, then every organization role), `ORGANIZATION_ROLE_LABELS`
in each collection's words ("Perfume house", "Distributor", "Museum"),
`organizationRoleText`, `COUNT_CAP` with `boundedCount` ("999+") and
`contributionText` ("124 editions · 3 films").

**Services** (`src/lib/actions/organization-directory.ts`):
- `getOrganizationDirectory`: one query for a page of rows with their roles
  and five counts (editions, perfumes, films, paintings, venues), each counted
  over at most `COUNT_CAP + 1` rows; one query for the total. Search by name or
  other name, ranked; one role at a time.
- `getOrganizationRoleCounts`: how many organizations hold each role among
  those the search finds, in one grouped query.
- `getOrganizationContributions`: the publisher profile (editions, books, the
  house above, the houses under), perfumes by role (house, brand,
  manufacturer) with retailer listings and bottles supplied, films produced
  and distributed with copies supplied, paintings owned and paintings
  at its venues now (confirmed and open whereabouts, as the painting home's
  venue filter reads them). Each list holds the first 24 works as cards
  (`loadPerfumeCards`, `loadFilmCards`, `loadPaintingCards`); each count is
  complete.
- `updateOrganizationProfile`: name, other names, country, website,
  description and the roles outside publishing. The book profile and the
  house above stay as the publisher page sets them, so a group stays a group.
  A role that records use cannot be removed: the database's message is shown.
- `removeOrganization`: `deleteOrganization` with a readable message when
  records still link to it.

**Screens**:
- `/organizations` (`src/app/organizations/page.tsx`): search, role chips with
  counts (`OrganizationFilters`), rows with roles, country and bounded counts
  (`OrganizationList`), pagination, "Add organization"
  (`OrganizationDialog`), no-results and empty states, a loading skeleton.
- `/organizations/[slug]`: the name and roles with the actions menu
  (`OrganizationActions`: Edit, Delete) on the name's cap-height center; parts
  for Books, Perfumes, Films, Paintings and Venues, each left out when empty;
  rows of cards with the full count and a link to the filtered collection home
  where one exists; the record column (roles, country, other names, publisher
  page, website). A sparse organization shows one line saying how it gets
  linked. Delete lists what still links to it. Loading and not-found states.
- The publisher page's Links group opens the organization page.
- Sidebar and command palette: "Organizations" after Publishers (Landmark
  icon). `HorizontalCarousel` takes a heading level and a count.

**Deferred**: maps and timelines of organizations; a role filter for more than
one role at a time; retailer and production company filters on the perfume and
film homes.

## Completion Notes
- Tests: `integration/organization-directory.test.ts` (database: one
  organization across books, perfumes, films and paintings with its roles and
  counts; role filter and counts, other-name search, paging; the 999+ cap on a
  publisher with 1,001 editions; editing keeps a group's and a publisher's
  level, parent and slug; a role in use cannot be removed; a sparse museum;
  delete of a linked and an unlinked organization) and
  `catalogue/organization-directory.test.ts` (words, counts, sidebar entry).

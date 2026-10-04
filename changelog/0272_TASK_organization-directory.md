# Task 0272: Shared Organization Directory (SLN-369)

**Status**: Completed
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
  icon).
- `SectionHeading` as an h3 takes `type-item-title` (a block inside a titled
  section, docs 03); `HorizontalCarousel` passes a heading level and a count
  through. The organization dialogs render at the end of the page (a portal),
  outside the title rows, so nothing in a title row holds them.
- `page-weight.json` gains `/organizations` and `/organizations/*`.

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
- Checks: `pnpm typecheck` clean; `pnpm lint` has no errors and no new
  warnings; `python3 scripts/qa/test-local.py` passes every suite (132 files,
  1,620 tests).
- Browser (headless Chrome, own profile) on `preview-local.py --from-dump` of
  the 2026-10-04 11:37 backup (264 organizations), with seeded films,
  perfumes, a painting, a perfume house (Guerlain), a museum with a venue and
  an owned painting (Rijksmuseum), a gallery with nothing linked, and Penguin
  Books as publisher, retailer and distributor. Audits at 1440 and 390px on
  the directory (all, one role, a search, no results), the add, edit and
  delete dialogs, a multi-role publisher, a perfume house, a museum, a sparse
  gallery, a publishing group and the publisher page: no deviation over
  0.5px, no text under 4.5:1, no unnamed or nested control, no overflow, no
  console error.
- Flows: added an organization with a role and another name (opens its page,
  found by the other name); edited a name and a role; removing Penguin's
  retailer role shows "This organization role is in use by perfume records"
  and keeps it; Delete on Penguin lists 82 editions, 3 houses under it, 1
  retailer listing and 1 film distributed, and stays off; an unlinked gallery
  deletes and the page returns to the directory.
- `page-weight.js` on that preview: `/organizations` 132 KB in 78 ms,
  `/organizations/*` 54 KB in 76 ms; Penguin's page 75 KB. Every other route
  is within budget except `/library` (313 KB), which this task does not change.

### Review fixes (PR #61)
- Country: editing (and adding) resolves the country id from the text, as the
  publisher form does, and clears it with the text; the page shows the
  country as written, like the publisher page and the directory.
- Row counts add the houses under an organization, the books wanted from it
  (acquisition targets) and the bottles and film copies it supplied, so a
  group or a supplier no longer reads "Nothing linked yet". A group's Books
  part counts its houses' editions ("Publishing group with 3 houses under
  it: 120 editions of 98 books in all").
- An organization that owns paintings cannot drop both the museum and the
  gallery role (`updateOrganizationProfile` checks it in the same
  transaction).
- A malformed or overlong address answers not found instead of an error.
- Each perfume role row links to its own list: the perfume home's `house`
  filter takes `houseRole` (`perfume_house`, `brand`, `manufacturer`).
- The Delete dialog lists books wanted from the organization and counts a
  venue it both runs and owns once.
- Tests: a group's and a supplier's rows, search within one role, the
  country id on edit, the painting owner guard, the role-narrowed house
  filter.

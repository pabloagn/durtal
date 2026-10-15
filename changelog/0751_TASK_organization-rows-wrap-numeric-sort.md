# Task 0751: Organization rows wrap, and names sort with their numbers in order

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-831. Design polish pass 4, item 3 (`findings/design-polish-4-2026-10-15.md`).

- On a phone every organization's roles line ended in an ellipsis ("Perfume house · Manufacturer · Production compa…"). It is the only line that says what the organization is. The counts line was cut the same way.
- Organization and place names sorted as text: Seed Organization 1, 10, 11 … 19, 2, 20.

## Implementation Details
- `src/components/organizations/organization-list.tsx`: the name wraps in full. The roles and country, and the counts, are a `FactsRow`, so they wrap between parts and no line starts with a separator. The counts are set once: under 640px the row wraps them to a line of their own under the roles; from 640px they sit at the row's end, on the name's baseline, up to 45% of its width.
- `src/lib/catalogue/organizations.ts`: `organizationRoleLabels` and `contributionParts` give the parts; `organizationRoleText` and `contributionText` join them as before for the organization's page.
- `FactsRow` takes `small` (12px), for a list row's secondary lines.
- `src/lib/actions/utils/natural-order.ts`, `naturalOrder`: a name's sort key with every run of digits padded to 20 places, so "Galerie 2" comes before "Galerie 10". The database's own collation still decides case and accents, and the name itself breaks ties, so paging stays stable. No migration: an ICU numeric collation would need one.
  - The organization directory (`getOrganizationDirectory`, also after search rank), the organization picker (`getOrganizations`) and Places by name (`getVenues`, both directions) use it.
- Tests: `src/__tests__/ui/organization-row-whole.test.ts`; numeric order in `src/__tests__/integration/organization-directory.test.ts` and `venue-pages.test.ts`.

## Completion Notes
See the PR's checks.

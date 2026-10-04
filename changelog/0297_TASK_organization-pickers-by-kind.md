# Task 0297: Organization pickers offer only their kinds

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

A perfume's House picker ("Search houses...") suggested publishing houses:
"47North · publisher", "AK Press · publisher", "Alfred A. Knopf · imprint".
Every organization picker had the same fault: `useOrganizationSearch(role)`
used `role` only for "Create" and searched every organization.

## Implementation Details

- `getOrganizations` takes `roles`: only organizations with at least one of
  them. Publisher and imprint match the book profile's kind; the other roles
  match `organization_roles`. Without `roles` the directory is unchanged.
- `useOrganizationSearch(role, roles = [role])` searches with `roles`:
  - perfume house picker: perfume house, brand, manufacturer
    (`PERFUME_ORGANIZATION_ROLES`);
  - film production companies: production company;
  - film version distributors: distribution company;
  - a painting's owning institution: museum, gallery;
  - suppliers and perfume retailers: retailer.
- A book's publisher picker already offered only publishers and imprints
  (`publisherCondition`); unchanged.

## Completion Notes

- Test: `organizations.test.ts`, "a picker offers only its kinds".
- Browser check on a disposable preview: with three publishers, two perfume
  houses and a film company, the perfume House picker offers only the two
  perfume houses.
- An organization with no role yet no longer appears in these pickers; it
  gets its role on its own page, or "Create" makes one with the right role.

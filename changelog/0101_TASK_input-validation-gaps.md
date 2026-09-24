# Task 0101: Add Missing Input Validation to Server Actions

**Status**: Completed
**Created**: 2026-04-06
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0097
**Blocks**: None

## Overview
Several server actions accept unvalidated input, bypassing the Zod schema pattern used elsewhere. This creates data integrity risks and inconsistent error handling.

## Implementation Details
Actions missing Zod validation:
- `createOrder` in `src/lib/actions/orders.ts` — no schema; enum values for status/method unchecked
- `createPlace` in `src/lib/actions/places.ts` — no validation at all
- `createLocation` in `src/lib/actions/locations.ts` — no validation
- `createSubLocation` / `updateSubLocation` / `deleteSubLocation` in `src/lib/actions/locations.ts`
- `createVenue` in `src/lib/actions/venues.ts` — no validation
- `updateWorkTaxonomy` in `src/lib/actions/taxonomy.ts` — junction table IDs not validated as UUIDs

For each, create a Zod schema in `src/lib/validations/` and apply `.parse()` at the top of the action.

## Additional Gaps
- Negative `limit`/`offset` not rejected in API routes (`/api/works`, `/api/authors`)
- Empty string not rejected for search query in `/api/search`, `/api/match`
- UUID format not validated on path params (`/api/works/[id]`, `/api/authors/[id]`)

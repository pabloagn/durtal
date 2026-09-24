# Task 0103: Wrap Multi-Step Mutations in Transactions

**Status**: Completed (reverted — neon-http driver has no transaction support)
**Created**: 2026-04-06
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0097
**Blocks**: None

## Overview
Several server actions perform multi-step database mutations without transactions, risking inconsistent state on partial failures.

## Implementation Details
Operations to wrap in `db.transaction()`:
1. **Slug generation** (works, authors, venues) — create → fetch existing slugs → update with unique slug (3+ round trips; race-condition-prone)
2. **mergeAuthors** in `src/lib/actions/authors.ts` — transfers across 3 junction tables with no rollback
3. **setActiveMedia** in `src/lib/actions/media.ts` — deactivates others then activates target (brief inconsistent state)
4. **updateWorkTaxonomy** in `src/lib/actions/taxonomy.ts` — 8 sequential delete/insert pairs on junction tables
5. **rematchEdition** in `src/lib/actions/editions.ts` — fetches external API → uploads to S3 → updates DB (failure in step 2 leaves orphaned S3 file)
6. **createOrder** + `syncWorkCatalogueStatusFromAllOrders` — order insert + work status update + history insert

Use Drizzle's `db.transaction(async (tx) => { ... })` pattern.

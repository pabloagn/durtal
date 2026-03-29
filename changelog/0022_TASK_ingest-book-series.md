# Task 0022: Ingestion — Book Series Data

**Status**: In Progress
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0006, 0019
**Blocks**: 0023

## Overview

Seed the `series` table from the Book_Series sheet, then reconcile with any series records that were auto-created during the Books ingestion (Task 0019). This task also handles the migration of `works.series_name` text values to proper `works.series_id` FK references, and eventually drops the deprecated `series_name` column.

## Source Data

- **Book_Series**: `knowledge_base.xlsx` → `Book_Series` sheet (153 rows, 6 columns)
  - Key columns: Title, Original Title, Author
  - Examples:
    - "In Search of Lost Time" / "A la recherche du temps perdu" (Proust, Marcel)
    - "The Dark Tower" / (King, Stephen)
    - "Discworld" / (Pratchett, Terry)

## Script Location

`scripts/ingest/seed_series.py`

## Implementation Details

### Phase 1: Seed Series Table

1. Read Book_Series sheet
2. Skip rows where Duplicated_Entry = "Y"
3. For each row, create a `series` record:
   - `title` from Title column
   - `original_title` from Original Title column
   - Generate `slug` from title
4. Deduplicate against existing series (some may have been auto-created in Task 0019)

### Phase 2: Reconcile Works

1. Query all works that still have `series_name` set but `series_id` = NULL
2. For each, match `series_name` against `series.title`
3. If match found, set `works.series_id` to the series ID
4. If no match, create a new series from `series_name` and link

### Phase 3: Drop series_name Column

After all works have been migrated to `series_id`:
1. Verify no works have `series_name` set without a corresponding `series_id`
2. Generate a Drizzle migration to drop `series_name` from `works`
3. Apply migration
4. Update `docs/01_SPECS.md`

## Implementation Steps

- [ ] Create `scripts/ingest/seed_series.py`
- [ ] Implement series seeding from Excel
- [ ] Implement reconciliation of works.series_name → series_id
- [ ] Add `--dry-run` flag
- [ ] Run seed and reconciliation
- [ ] Generate and apply migration to drop `series_name`
- [ ] Update specs
- [ ] Run `pnpm typecheck`

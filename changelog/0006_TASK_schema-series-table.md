# Task 0006: Schema — Series Table (Normalize from Works Text Fields)

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0022, 0023

## Overview

Replace the free-text `series_name` field on `works` with a proper normalized `series` table. Currently, series membership is stored as a plain string on each work, making it impossible to reliably group works by series, display series metadata, or navigate between series entries. This task creates a first-class `series` entity with its own page and navigation entry.

## Source Data

- **Book_Series**: `knowledge_base.xlsx` → `Book_Series` sheet (153 rows)
  - Columns: Title, Original Title, Author, Composite_Work_Author, Composite_Author_Work, Duplicated_Entry
  - Examples: "In Search of Lost Time" / "A la recherche du temps perdu" by Proust, Marcel

## Schema: `series`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `title` | `TEXT` | NOT NULL | Series title in display language |
| `original_title` | `TEXT` | nullable | Original-language title if different |
| `slug` | `TEXT` | NOT NULL, UNIQUE | URL-safe identifier |
| `description` | `TEXT` | nullable | Description of the series |
| `total_volumes` | `SMALLINT` | nullable | Expected number of volumes (if known) |
| `is_complete` | `BOOLEAN` | DEFAULT `false` | Whether the series is finished |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

**Indexes**: `title` (GIN trigram), `slug` (B-tree)

## Schema Changes to `works`

- Add `series_id` (UUID, FK → `series.id` ON DELETE SET NULL, nullable) to `works`
- **Keep** `series_position` (already exists as DECIMAL)
- **Deprecate** `series_name` — migrate existing data to FK, then drop column in a follow-up migration

## Migration Strategy

1. Create `series` table
2. Add `series_id` FK to `works`
3. Migrate existing `series_name` values: for each unique `series_name`, create a `series` row, then update `works.series_id` to point to it
4. Drop `series_name` column from `works`

Steps 3–4 happen during data ingestion (Task 0022), not in this schema-only task. This task creates the table and adds the FK column alongside the existing text field.

## Implementation Steps

- [ ] Create `src/lib/db/schema/series.ts` with Drizzle table definition
- [ ] Add `seriesId` FK column to `works` schema (keep `seriesName` for now)
- [ ] Export from `src/lib/db/schema/index.ts`
- [ ] Generate and apply Drizzle migration
- [ ] Update `docs/01_SPECS.md` (add series table, update works table)
- [ ] Run `pnpm typecheck`

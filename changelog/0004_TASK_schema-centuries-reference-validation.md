# Task 0004: Schema — Centuries Reference Table and Validation Constraints

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0015

## Overview

Create a small reference table for century labels used in filtering and display. The Validation_Fields sheet from the Excel source contains centuries (13th–21st), including cross-century spans (e.g., "19th/20th Century"). These are used for filtering books by era.

The other validation fields (Score 0–5, Score 1–5, Check Y/N) do NOT warrant separate tables — they map to existing CHECK constraints (rating) and booleans. Only centuries get a table because the labels include non-trivial cross-century spans that cannot be trivially computed from a year.

## Source Data

- **Validation_Fields**: `knowledge_base.xlsx` → `Validation_Fields` sheet
  - Centuries column (14 values): 13th Century, 13th/14th Century, 15th Century, ..., 21st Century

## Schema: `centuries`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `label` | `TEXT` | NOT NULL, UNIQUE | Display label (e.g., "19th Century", "19th/20th Century") |
| `start_year` | `SMALLINT` | NOT NULL | Inclusive start year (e.g., 1200 for "13th Century") |
| `end_year` | `SMALLINT` | NOT NULL | Inclusive end year (e.g., 1299 for "13th Century") |
| `sort_order` | `SMALLINT` | NOT NULL | For chronological ordering |

This table serves as a reference for UI filters. Works and editions can be mapped to centuries via their year fields at query time — no FK needed.

## Design Decision: No Tables for Other Validation Fields

- **Score (0–5 in 0.5 steps)**: Rating is already constrained via CHECK on `works.rating`. Half-step scores can be handled by changing the CHECK or using DECIMAL. No table.
- **Score (1–5 integer)**: Same as above.
- **Check (Y/N)**: Boolean fields. No table.

## Implementation Steps

- [ ] Create `src/lib/db/schema/centuries.ts` with Drizzle table definition
- [ ] Export from `src/lib/db/schema/index.ts`
- [ ] Generate and apply Drizzle migration
- [ ] Update `docs/01_SPECS.md`
- [ ] Run `pnpm typecheck`

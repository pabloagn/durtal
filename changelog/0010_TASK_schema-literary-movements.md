# Task 0010: Schema — Literary Movements Table (3-Level Hierarchy)

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0016

## Overview

Create a `literary_movements` table with a 3-level hierarchy to classify works by their intellectual and artistic lineage. The hierarchy goes: Level 1 — Era/Broad School (e.g., "Ancient / Classical") → Level 2 — Movement (e.g., "Hellenistic Philosophy") → Level 3 — Sub-movement (e.g., "Stoicism").

## Source Data

- **Literary_Movements**: `knowledge_base.xlsx` → `Literary_Movements` sheet (217 rows)
  - Columns: Level 1 (Era/Broad School), Level 2 (Movement), Level 3 (Sub-movement/Related), Notes / Scope Example
  - Examples:
    - Ancient / Classical > Ancient Greek Philosophy > Pre-Socratic
    - Modernism > Surrealism > Automatic Writing
    - Romanticism > Dark Romanticism > Gothic Fiction

## Schema: `literary_movements`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL | Movement name at this level |
| `slug` | `TEXT` | NOT NULL, UNIQUE | URL-safe full-path identifier |
| `level` | `SMALLINT` | NOT NULL | Hierarchy depth: 1, 2, or 3 |
| `parent_id` | `UUID` | FK → `literary_movements.id` ON DELETE CASCADE, nullable | Parent movement |
| `scope_notes` | `TEXT` | nullable | Scope and context notes |
| `sort_order` | `INTEGER` | DEFAULT `0` | |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

**Indexes**: `name` (B-tree), `slug` (B-tree), `parent_id` (B-tree), `level` (B-tree)

**Unique constraint**: `(parent_id, name)`

## Junction Table: `work_literary_movements`

| Column | Type | Constraints |
|--------|------|-------------|
| `work_id` | `UUID` | FK → `works.id` ON DELETE CASCADE |
| `literary_movement_id` | `UUID` | FK → `literary_movements.id` ON DELETE CASCADE |

**PK**: `(work_id, literary_movement_id)`

## Implementation Steps

- [ ] Create `src/lib/db/schema/literary-movements.ts` with both tables
- [ ] Export from `src/lib/db/schema/index.ts`
- [ ] Generate and apply Drizzle migration
- [ ] Update `docs/01_SPECS.md`
- [ ] Run `pnpm typecheck`

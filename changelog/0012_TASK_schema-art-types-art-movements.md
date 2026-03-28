# Task 0012: Schema — Art Types and Art Movements Tables

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0016

## Overview

Create tables for art types (forms of artistic expression) and art movements (stylistic/historical groupings). Only art types associated with literature are ingested per user requirement, but the schema should accommodate all types for completeness. Art movements are a flat list of named movements (Abstract, Baroque, Surrealism, etc.).

## Source Data

- **Art_Types**: `knowledge_base.xlsx` → `Art_Types` sheet (170 rows)
  - Columns: Book_Type, Description, Applicable_Work_Type(s), Duplicated_Entry
  - Examples: Biography, Autobiography, Manuscript, Codex, Almanac, Graphic Novel, Libretto, Novella
  - Note: `Applicable_Work_Type(s)` links to Work_Types (e.g., "Book", "Book; Manuscript")
- **Art_Movements**: `knowledge_base.xlsx` → `Art_Movements` sheet (86 rows)
  - Columns: Art_Movements, Duplicate_Entry
  - Examples: Abstract, Art Deco, Art Nouveau, Baroque, Constructivism, Cubism, Dadaism, Expressionism, Futurism, Gothic, Impressionism, Minimalism, Modernism, Neoclassicism, Pop Art, Post-Impressionism, Realism, Romanticism, Superflat, Surrealism

## Schema: `art_types`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL, UNIQUE | Art type name (e.g., "Biography", "Novella") |
| `slug` | `TEXT` | NOT NULL, UNIQUE | URL-safe identifier |
| `description` | `TEXT` | nullable | What this art type encompasses |
| `applicable_work_types` | `TEXT` | nullable | Comma-separated work types this art type applies to |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

**Indexes**: `name` (B-tree), `slug` (B-tree)

## Schema: `art_movements`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL, UNIQUE | Movement name (e.g., "Surrealism") |
| `slug` | `TEXT` | NOT NULL, UNIQUE | URL-safe identifier |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

**Indexes**: `name` (B-tree), `slug` (B-tree)

## Junction Tables

### `work_art_types`

| Column | Type | Constraints |
|--------|------|-------------|
| `work_id` | `UUID` | FK → `works.id` ON DELETE CASCADE |
| `art_type_id` | `UUID` | FK → `art_types.id` ON DELETE CASCADE |

**PK**: `(work_id, art_type_id)`

### `work_art_movements`

| Column | Type | Constraints |
|--------|------|-------------|
| `work_id` | `UUID` | FK → `works.id` ON DELETE CASCADE |
| `art_movement_id` | `UUID` | FK → `art_movements.id` ON DELETE CASCADE |

**PK**: `(work_id, art_movement_id)`

## Implementation Steps

- [ ] Create `src/lib/db/schema/art-types.ts` with table and junction
- [ ] Create `src/lib/db/schema/art-movements.ts` with table and junction
- [ ] Export from `src/lib/db/schema/index.ts`
- [ ] Generate and apply Drizzle migration
- [ ] Update `docs/01_SPECS.md`
- [ ] Run `pnpm typecheck`

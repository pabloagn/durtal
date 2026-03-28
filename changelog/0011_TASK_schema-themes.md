# Task 0011: Schema — Themes Table (3-Level Hierarchy)

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0016

## Overview

Create a `themes` table with a 3-level hierarchy for thematic classification of works. Distinct from subjects (which are broad intellectual areas) — themes are specific recurring motifs, ideas, and concerns within a work. Hierarchy: Category (e.g., "Human Condition") → Subcategory (e.g., "Mortality") → Theme (e.g., "Death").

## Source Data

- **Themes**: `knowledge_base.xlsx` → `Themes` sheet (567 rows)
  - Columns: Category, Subcategory, Theme
  - Examples:
    - Human Condition > Mortality > Death
    - Human Condition > Identity > Self-Discovery
    - Society & Power > Class & Hierarchy > Aristocracy
    - Art & Aesthetics > Beauty > Sublime

## Schema: `themes`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL | Theme name at this level |
| `slug` | `TEXT` | NOT NULL, UNIQUE | URL-safe full-path identifier |
| `level` | `SMALLINT` | NOT NULL | Hierarchy depth: 1 (category), 2 (subcategory), 3 (theme) |
| `parent_id` | `UUID` | FK → `themes.id` ON DELETE CASCADE, nullable | Parent theme/category |
| `sort_order` | `INTEGER` | DEFAULT `0` | |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

**Indexes**: `name` (B-tree), `slug` (B-tree), `parent_id` (B-tree), `level` (B-tree)

**Unique constraint**: `(parent_id, name)`

## Junction Table: `work_themes`

| Column | Type | Constraints |
|--------|------|-------------|
| `work_id` | `UUID` | FK → `works.id` ON DELETE CASCADE |
| `theme_id` | `UUID` | FK → `themes.id` ON DELETE CASCADE |

**PK**: `(work_id, theme_id)`

## Implementation Steps

- [ ] Create `src/lib/db/schema/themes.ts` with both tables
- [ ] Export from `src/lib/db/schema/index.ts`
- [ ] Generate and apply Drizzle migration
- [ ] Update `docs/01_SPECS.md`
- [ ] Run `pnpm typecheck`

# Task 0009: Schema — Book Categories Table (3-Level Hierarchy)

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0016

## Overview

Create a `book_categories` table with a 3-level hierarchy for comprehensive book classification. This is **separate from the existing `genres` table** — genres are edition-level marketing/publishing categories, while book categories are a formal, structured classification system applied at the work level. The hierarchy goes: Level 1 (e.g., "Fiction") → Level 2 (e.g., "Literary Fiction") → Level 3 (e.g., "Classics").

## Source Data

- **Book_Categories**: `knowledge_base.xlsx` → `Book_Categories` sheet (825 rows)
  - Columns: Category_1, Category_2, Category_3, Notes_Scope_Example
  - Examples:
    - Fiction > Literary Fiction > Classics
    - Fiction > Genre Fiction > Horror > Cosmic Horror
    - Non-Fiction > Philosophy > Existentialism
    - Non-Fiction > History > Ancient History

## Schema: `book_categories`

Uses self-referential hierarchy (same pattern as existing `genres` table).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL | Category name at this level |
| `slug` | `TEXT` | NOT NULL, UNIQUE | URL-safe identifier (full path slug for uniqueness) |
| `level` | `SMALLINT` | NOT NULL | Hierarchy depth: 1, 2, or 3 |
| `parent_id` | `UUID` | FK → `book_categories.id` ON DELETE CASCADE, nullable | Parent category |
| `scope_notes` | `TEXT` | nullable | Notes on what this category covers (from Notes_Scope_Example) |
| `sort_order` | `INTEGER` | DEFAULT `0` | |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

**Indexes**: `name` (B-tree), `slug` (B-tree), `parent_id` (B-tree), `level` (B-tree)

**Unique constraint**: `(parent_id, name)` — no duplicate names under the same parent

## Junction Table: `work_categories`

| Column | Type | Constraints |
|--------|------|-------------|
| `work_id` | `UUID` | FK → `works.id` ON DELETE CASCADE |
| `category_id` | `UUID` | FK → `book_categories.id` ON DELETE CASCADE |

**PK**: `(work_id, category_id)`

## Implementation Steps

- [ ] Create `src/lib/db/schema/book-categories.ts` with both tables
- [ ] Export from `src/lib/db/schema/index.ts`
- [ ] Generate and apply Drizzle migration
- [ ] Update `docs/01_SPECS.md`
- [ ] Run `pnpm typecheck`

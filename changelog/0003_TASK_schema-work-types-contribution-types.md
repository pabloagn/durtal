# Task 0003: Schema — Work Types and Contribution Types Lookup Tables

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0015, 0018, 0019, 0020

## Overview

Create two lookup tables that formalize the classification of creative works and the roles people play in creating them. Currently, work types are implicit (only `is_anthology` boolean on works) and contribution roles are hardcoded strings in `work_authors.role` and `edition_contributors.role`. These tables provide a proper taxonomy.

## Source Data

- **Work_Types**: `knowledge_base.xlsx` → `Work_Types` sheet (34 rows)
  - Columns: Name, Description
  - Examples: Book, Poem, Play, Essay, Film, Painting, Sculpture, Musical Composition, Photograph
- **Contribution_Types**: `knowledge_base.xlsx` → `Contribution_Types` sheet (50 rows)
  - Columns: Name, Description, Examples of Use
  - Examples: Author, Painter, Composer, Translator, Editor, Illustrator, Photographer, Director

## Schema: `work_types`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL, UNIQUE | e.g., "Book", "Poem", "Essay" |
| `slug` | `TEXT` | NOT NULL, UNIQUE | URL-safe identifier |
| `description` | `TEXT` | nullable | What this type encompasses |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

**Indexes**: `name` (B-tree), `slug` (B-tree)

## Schema: `contribution_types`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL, UNIQUE | e.g., "Author", "Translator", "Editor" |
| `slug` | `TEXT` | NOT NULL, UNIQUE | URL-safe identifier |
| `description` | `TEXT` | nullable | Role description |
| `applicable_work_types` | `TEXT` | nullable | Comma-separated work types this role applies to |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

**Indexes**: `name` (B-tree), `slug` (B-tree)

## Schema Impact on Existing Tables

- Add `work_type_id` (UUID, FK → `work_types.id`, nullable) to `works` table
- The existing hardcoded role strings in `work_authors.role` and `edition_contributors.role` should eventually reference `contribution_types`, but this FK migration happens after data ingestion (not in this task)

## Junction Table: `author_contribution_types`

Links authors to their known contribution types (what they "do" — writer, poet, translator, etc.). This captures the People.Type field from the Excel data.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `author_id` | `UUID` | FK → `authors.id` ON DELETE CASCADE | |
| `contribution_type_id` | `UUID` | FK → `contribution_types.id` ON DELETE CASCADE | |

**PK**: `(author_id, contribution_type_id)`

## Implementation Steps

- [ ] Create `src/lib/db/schema/work-types.ts` with Drizzle table definition
- [ ] Create `src/lib/db/schema/contribution-types.ts` with Drizzle table definition (includes `author_contribution_types` junction)
- [ ] Add `workTypeId` FK column to `works` table in existing schema
- [ ] Export from `src/lib/db/schema/index.ts`
- [ ] Generate and apply Drizzle migration
- [ ] Update `docs/01_SPECS.md` with new table definitions
- [ ] Run `pnpm typecheck`

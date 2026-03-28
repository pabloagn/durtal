# Task 0013: Schema — Keywords and Attributes Tables

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0016

## Overview

Create two flat taxonomy tables — `keywords` (free-form descriptive tags) and `attributes` (stylistic/tonal descriptors with categories). Both link to works for classification and filtering.

Keywords are single descriptive terms (e.g., "Abracadabra", "Alchemy", "Apocalypse"). Attributes are descriptors of a work's style or character (e.g., "Academic", "Avant-garde", "Dystopian") organized into categories (Style/Approach, Tone, Setting, etc.).

## Source Data

- **Keywords**: `knowledge_base.xlsx` → `Keywords` sheet (287 rows)
  - Columns: Name
  - Examples: Abracadabra, Alchemy, Allegory, Amulets, Angels, Apocalypse, Astrology
- **Attributes**: `knowledge_base.xlsx` → `Attributes` sheet (70 rows)
  - Columns: Name, Description (Optional), Category (Optional), Duplicated_Entry
  - Examples: Academic (Style/Approach), Allegorical (Style/Approach), Atmospheric (Tone), Dystopian (Setting)

## Schema: `keywords`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL, UNIQUE | Keyword |
| `slug` | `TEXT` | NOT NULL, UNIQUE | URL-safe identifier |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

## Schema: `attributes`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL, UNIQUE | Attribute name |
| `slug` | `TEXT` | NOT NULL, UNIQUE | URL-safe identifier |
| `description` | `TEXT` | nullable | What this attribute means |
| `category` | `TEXT` | nullable | Grouping category (Style/Approach, Tone, Setting, etc.) |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

**Indexes**: `name` (B-tree), `category` (B-tree)

## Junction Tables

### `work_keywords`

| Column | Type | Constraints |
|--------|------|-------------|
| `work_id` | `UUID` | FK → `works.id` ON DELETE CASCADE |
| `keyword_id` | `UUID` | FK → `keywords.id` ON DELETE CASCADE |

**PK**: `(work_id, keyword_id)`

### `work_attributes`

| Column | Type | Constraints |
|--------|------|-------------|
| `work_id` | `UUID` | FK → `works.id` ON DELETE CASCADE |
| `attribute_id` | `UUID` | FK → `attributes.id` ON DELETE CASCADE |

**PK**: `(work_id, attribute_id)`

## Implementation Steps

- [ ] Create `src/lib/db/schema/keywords.ts` with table and junction
- [ ] Create `src/lib/db/schema/attributes.ts` with table and junction
- [ ] Export from `src/lib/db/schema/index.ts`
- [ ] Generate and apply Drizzle migration
- [ ] Update `docs/01_SPECS.md`
- [ ] Run `pnpm typecheck`

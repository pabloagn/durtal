# Task 0005: Schema — Sources Table

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0015

## Overview

Create a simple `sources` table to store external sites/platforms where books can be found, purchased, or referenced. This is a flat reference list — concept + URL pairs.

## Source Data

- **URLs**: `knowledge_base.xlsx` → `URLs` sheet (14 rows)
  - Columns: Concept, URL
  - Examples: "Goodreads Book" → "https://www.goodreads.com/book/show/", "Hardcover Book" → URL

## Schema: `sources`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL, UNIQUE | Concept/platform name (e.g., "Goodreads Book") |
| `url` | `TEXT` | nullable | Base URL for the source |
| `description` | `TEXT` | nullable | Optional description of what this source provides |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

## Implementation Steps

- [ ] Create `src/lib/db/schema/sources.ts` with Drizzle table definition
- [ ] Export from `src/lib/db/schema/index.ts`
- [ ] Generate and apply Drizzle migration
- [ ] Update `docs/01_SPECS.md`
- [ ] Run `pnpm typecheck`

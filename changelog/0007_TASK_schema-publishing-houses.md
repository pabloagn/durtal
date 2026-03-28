# Task 0007: Schema — Publishing Houses and Publisher Specialties Tables

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Infrastructure
**Depends On**: 0002
**Blocks**: 0017

## Overview

Create tables for publishing houses and their specialty areas. Currently, publisher is a free-text field on `editions`. This task creates a proper `publishing_houses` entity so publishers can be browsed, filtered, and linked to their specialties. The `editions.publisher` text field remains for now — FK migration happens after data ingestion.

## Source Data

- **Publishing_Houses**: `knowledge_base.xlsx` → `Publishing_Houses` sheet (172 rows)
  - Columns: Publishing_House, Country, Duplicated_Entry, Specialties
  - Examples: "Alfred A. Knopf" (United States, "Literary Fiction; Non-fiction"), "Tartarus Press" (United Kingdom, "Supernatural Fiction; Weird Fiction")
- **Publisher_Specialties**: `knowledge_base.xlsx` → `Publisher_Specialties` sheet (163 rows)
  - Columns: Name
  - Examples: "Academic Publishing; Scholarly Works", "Literary Fiction", "Occult Literature; Esoteric Studies"

## Schema: `publishing_houses`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL, UNIQUE | Publisher name |
| `slug` | `TEXT` | NOT NULL, UNIQUE | URL-safe identifier |
| `country` | `TEXT` | nullable | Country of primary operations |
| `country_id` | `UUID` | FK → `countries.id` ON DELETE SET NULL, nullable | Normalized country reference |
| `description` | `TEXT` | nullable | Brief description |
| `website` | `TEXT` | nullable | Publisher website |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

**Indexes**: `name` (B-tree), `slug` (B-tree), `country_id` (B-tree)

## Schema: `publisher_specialties`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL, UNIQUE | Specialty name |
| `slug` | `TEXT` | NOT NULL, UNIQUE | URL-safe identifier |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

## Junction Table: `publishing_house_specialties`

| Column | Type | Constraints |
|--------|------|-------------|
| `publishing_house_id` | `UUID` | FK → `publishing_houses.id` ON DELETE CASCADE |
| `specialty_id` | `UUID` | FK → `publisher_specialties.id` ON DELETE CASCADE |

**PK**: `(publishing_house_id, specialty_id)`

## Implementation Steps

- [ ] Create `src/lib/db/schema/publishing-houses.ts` (includes all three tables)
- [ ] Export from `src/lib/db/schema/index.ts`
- [ ] Generate and apply Drizzle migration
- [ ] Update `docs/01_SPECS.md`
- [ ] Run `pnpm typecheck`

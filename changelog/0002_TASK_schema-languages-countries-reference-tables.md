# Task 0002: Schema — Languages and Countries Reference Tables

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0015, 0018, 0019, 0020

## Overview

Create two foundational reference tables — `languages` and `countries` — that normalize language and country data currently stored as free-text or short codes across works, editions, authors, and locations. These tables replace ad-hoc strings with proper FK relationships and provide ISO-standard codes for consistent filtering and display.

## Source Data

- **Languages**: `knowledge_base.xlsx` → `Languages` sheet (448 rows)
  - Columns: Hash_ID, Language, ISO_639-1, ISO_639-2, ISO_639-3 (with duplicate flags)
- **Countries_Continents**: `knowledge_base.xlsx` → `Countries_Continents` sheet (262 rows)
  - Columns: Continent_Name, Continent_Code, Country_Name, Two_Letter_Country_Code, Three_Letter_Country_Code, Country_Number

## Schema: `languages`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL, UNIQUE | Display name (e.g., "Mandarin Chinese") |
| `iso_639_1` | `VARCHAR(5)` | nullable, UNIQUE | ISO 639-1 two-letter code (e.g., "zh") |
| `iso_639_2` | `VARCHAR(10)` | nullable | ISO 639-2 three-letter code (e.g., "chi/zho") |
| `iso_639_3` | `VARCHAR(5)` | nullable | ISO 639-3 three-letter code (e.g., "cmn") |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

**Indexes**: `name` (B-tree), `iso_639_1` (B-tree)

## Schema: `countries`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK | |
| `name` | `TEXT` | NOT NULL, UNIQUE | Full country name |
| `alpha_2` | `VARCHAR(2)` | NOT NULL, UNIQUE | ISO 3166-1 alpha-2 (e.g., "NL") |
| `alpha_3` | `VARCHAR(3)` | NOT NULL, UNIQUE | ISO 3166-1 alpha-3 (e.g., "NLD") |
| `numeric_code` | `SMALLINT` | nullable | ISO 3166-1 numeric |
| `continent_name` | `TEXT` | nullable | Continent name (e.g., "Europe") |
| `continent_code` | `VARCHAR(2)` | nullable | Continent code (e.g., "EU") |
| `created_at` | `TIMESTAMPTZ` | DEFAULT `NOW()` | |

**Indexes**: `name` (B-tree), `alpha_2` (B-tree), `alpha_3` (B-tree), `continent_name` (B-tree)

## Schema Impact on Existing Tables

After these tables exist, future tasks may optionally refactor existing free-text fields to FK references:
- `works.original_language` → FK to `languages`
- `editions.language` → FK to `languages`
- `editions.publication_country` → FK to `countries`
- `authors.nationality` → FK to `countries`
- `locations.country` / `locations.country_code` → FK to `countries`

These FK migrations are **not** part of this task — they should happen after data ingestion to avoid breaking existing data flows.

## Implementation Steps

- [ ] Create `src/lib/db/schema/languages.ts` with Drizzle table definition
- [ ] Create `src/lib/db/schema/countries.ts` with Drizzle table definition
- [ ] Export from `src/lib/db/schema/index.ts`
- [ ] Generate Drizzle migration (`pnpm db:generate`)
- [ ] Apply migration (`pnpm db:migrate`)
- [ ] Update `docs/01_SPECS.md` with new table definitions
- [ ] Run `pnpm typecheck`

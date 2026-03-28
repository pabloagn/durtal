# Task 0008: Schema — Extend Authors Table

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: 0003
**Blocks**: 0018

## Overview

Extend the `authors` table to accommodate the richer biographical data available in the People sheet of the knowledge base. The current schema stores only `name`, `sort_name`, `birth_year`, `death_year`, and `nationality`. The source data includes first/last name decomposition, real names (for pen names), gender, and day/month-level date precision with approximate-date flags.

## Source Data

- **People**: `knowledge_base.xlsx` → `People` sheet (2541 rows, 21 columns)
  - Key columns beyond current schema:
    - `Name` (first name), `Surname` (last name) — currently only `name` (full) and `sort_name`
    - `Real Name` — for pen name / stage name situations
    - `Type` — semicolon-separated roles (e.g., "Writer; Poet; Dramatist")
    - `Gender` — Male, Female, etc.
    - `Birth_Date_Day`, `Birth_Date_Month`, `Birth_Date_Year`, `Birth_Date_Year_Gregorian`, `Birth_Date_Year_IsRange`
    - `Death_Date_Day`, `Death_Date_Month`, `Death_Date_Year`, `Death_Date_Year_Gregorian`, `Death_Date_Year_IsRange`
    - `Has_Image [Y/N]`

## New Columns on `authors`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `first_name` | `TEXT` | nullable | Given name |
| `last_name` | `TEXT` | nullable | Surname / family name |
| `real_name` | `TEXT` | nullable | Birth name if different from display name (pen names, stage names) |
| `gender` | `TEXT` | nullable | Male, Female, Non-binary, etc. |
| `birth_day` | `SMALLINT` | nullable | Day of birth (1–31) |
| `birth_month` | `SMALLINT` | nullable | Month of birth (1–12) |
| `birth_year_is_approximate` | `BOOLEAN` | DEFAULT `false` | True if birth year is estimated or a range |
| `death_day` | `SMALLINT` | nullable | Day of death |
| `death_month` | `SMALLINT` | nullable | Month of death |
| `death_year_is_approximate` | `BOOLEAN` | DEFAULT `false` | True if death year is estimated or a range |
| `birth_year_gregorian` | `TEXT` | nullable | Gregorian calendar representation (for BCE/non-standard calendars) |
| `death_year_gregorian` | `TEXT` | nullable | Gregorian calendar representation |

`birth_year` and `death_year` already exist — no changes needed there.

## Author Type Tagging

The People.Type field (e.g., "Writer; Poet; Dramatist") maps to the `contribution_types` table created in Task 0003. The junction table `author_contribution_types` (also from Task 0003) links authors to their known roles.

During ingestion (Task 0018), each semicolon-separated type value is matched to a `contribution_types` row and linked via the junction table. This lets queries like "show all Poets" or "show all Translators" work correctly.

## Implementation Steps

- [ ] Add new columns to `src/lib/db/schema/authors.ts`
- [ ] Generate and apply Drizzle migration
- [ ] Update `docs/01_SPECS.md` authors table definition
- [ ] Update any TypeScript types that explicitly reference author fields
- [ ] Run `pnpm typecheck`

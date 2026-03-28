# Task 0014: Schema — Extend Subjects Table (Add Description)

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0016

## Overview

Extend the existing `subjects` table with a `description` column. The current schema has only `name` and `slug`. The source data provides optional descriptions for subjects.

## Source Data

- **Subjects**: `knowledge_base.xlsx` → `Subjects` sheet (238 rows)
  - Columns: Name, Description (Optional)
  - Examples:
    - "Academic Study" — "Formal scholarly examination of a topic."
    - "Alchemy" — (no description)
    - "Existentialism" — (no description)

## Schema Change

Add to existing `subjects` table:

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `description` | `TEXT` | nullable | Optional description of the subject |

## Implementation Steps

- [ ] Add `description` column to `src/lib/db/schema/subjects.ts`
- [ ] Generate and apply Drizzle migration
- [ ] Update `docs/01_SPECS.md` subjects table definition
- [ ] Run `pnpm typecheck`

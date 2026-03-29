# Task 0018: Ingestion — People to Authors (Writers, Editors, Novelists)

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0003, 0008, 0015
**Blocks**: 0019, 0020

## Overview

Ingest people from the knowledge base into the `authors` table, filtering to only literature-related roles. Each person must be correctly tagged with their contribution types so the system knows exactly what each person does (writer, poet, editor, translator, etc.).

## Source Data

- **People**: `knowledge_base.xlsx` → `People` sheet (2541 rows, 21 columns)

### Column Mapping

| Excel Column | → Durtal Field | Notes |
|-------------|----------------|-------|
| `Name` | `first_name` | Given name |
| `Surname` | `last_name` | Family name |
| `Name + Surname` | `name` | Full display name (compute if formula) |
| `Surname, Name` | `sort_name` | Inverted for alphabetical sort |
| `Real Name` | `real_name` | Pen name / stage name resolution |
| `Type` | → `author_contribution_types` junction | Semicolon-separated roles |
| `Gender` | `gender` | |
| `Nationality` | `nationality` | Match to country if possible |
| `Birth_Date_Day` | `birth_day` | |
| `Birth_Date_Month` | `birth_month` | |
| `Birth_Date_Year` | `birth_year` | |
| `Birth_Date_Year_Gregorian` | `birth_year_gregorian` | For BCE dates |
| `Birth_Date_Year_IsRange` | `birth_year_is_approximate` | |
| `Death_Date_Day` | `death_day` | |
| `Death_Date_Month` | `death_month` | |
| `Death_Date_Year` | `death_year` | |
| `Death_Date_Year_Gregorian` | `death_year_gregorian` | |
| `Death_Date_Year_IsRange` | `death_year_is_approximate` | |
| `Has_Image [Y/N]` | (informational) | May inform future photo ingestion |

## Filtering Logic

Only ingest people whose `Type` field contains at least one literature-related role. Literature-related roles include (but are not limited to):

- Writer, Author, Novelist, Poet, Essayist, Playwright, Dramatist
- Editor, Literary Critic, Literary Theorist
- Translator, Lexicographer, Grammarian
- Philosopher, Historian, Theologian, Scholar, Academic
- Short Story Writer, Memoirist, Biographer, Autobiographer
- Journalist, Correspondent, Columnist
- Screenwriter, Librettist, Lyricist

People who are ONLY painters, sculptors, architects, composers, perfumers, photographers, directors, etc. (with no literary role) should be **excluded**.

The safest approach: build a set of excluded-only types (e.g., a person who is ONLY "Painter" or ONLY "Architect; Sculptor" is excluded). If they have ANY literary role alongside non-literary ones, include them (e.g., "Architect; Writer" → include).

## Script Location

`scripts/ingest/seed_authors.py`

## Implementation Details

### Name Handling

- Excel `Name` and `Surname` fields map to `first_name` and `last_name`
- `name` (display name) = `first_name + " " + last_name` (or just `first_name` if surname is empty)
- `sort_name` = `last_name + ", " + first_name` (or just `first_name` if surname is empty)
- Handle formula cells in Hash_ID and composite name columns — compute values from raw Name/Surname

### Type Tagging

1. Parse Type field: split on semicolons, trim whitespace
2. For each role, look up in `contribution_types` table (seeded in Task 0015)
3. If exact match not found, try fuzzy matching (e.g., "Short Story Writer" might be "Short Story Author" in contribution_types)
4. Insert into `author_contribution_types` junction table
5. Log unmatched types for manual review

### Deduplication

- Check `Duplicated_Entry` column — skip rows flagged "Y"
- Before inserting, check if author already exists by `name` match
- Upsert logic: update existing authors with richer data if new data has more fields populated

### Date Handling

- Birth/death years may be negative (BCE) — store as negative SMALLINT
- `IsRange` flag → `birth_year_is_approximate` / `death_year_is_approximate`
- Gregorian field is for display — store as text

## Implementation Steps

- [ ] Create `scripts/ingest/seed_authors.py`
- [ ] Implement literature-role filter
- [ ] Implement name parsing and normalization
- [ ] Implement type tagging via contribution_types junction
- [ ] Implement date field mapping
- [ ] Add `--dry-run` and `--limit <n>` flags
- [ ] Test with `uv run python -m scripts.ingest.seed_authors --dry-run --limit 50`
- [ ] Run full ingestion
- [ ] Verify author count and type tags in Drizzle Studio
- [ ] Log statistics: total people, filtered count, ingested count, unmatched types

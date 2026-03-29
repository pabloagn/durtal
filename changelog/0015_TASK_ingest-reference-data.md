# Task 0015: Ingestion — Seed Reference Data

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0002, 0003, 0004, 0005
**Blocks**: 0017, 0018, 0019, 0020

## Overview

Create a Python ingestion script to seed all reference/lookup tables from the knowledge base Excel file. These are foundational data that must exist before core data (books, authors) can be ingested with proper FK references.

## Tables to Seed

| Table | Source Sheet | Rows | Notes |
|-------|-------------|------|-------|
| `languages` | Languages | 448 | Deduplicate on ISO 639-1 (some have duplicates flagged) |
| `countries` | Countries_Continents | 262 | Extract continent info alongside country |
| `centuries` | Validation_Fields | 14 | Parse century labels, compute start/end years |
| `work_types` | Work_Types | 34 | Name + Description, generate slugs |
| `contribution_types` | Contribution_Types | 50 | Name + Description + Examples of Use |
| `sources` | URLs | 14 | Concept + URL pairs |

## Source File

`/home/pabloagn/dev/phantom/src/packages/phantom-canon/data/knowledge_base.xlsx`

## Script Location

`scripts/ingest/seed_reference.py`

## Implementation Details

- Read Excel with `openpyxl` (already a dependency)
- Skip rows flagged as duplicates (where applicable)
- Generate URL-safe slugs from names
- Use `psycopg2` for direct database insertion
- Support `--dry-run` flag to preview without inserting
- Support `--table <name>` flag to seed a single table
- Upsert logic: skip existing rows (match on unique name/code), report counts
- Log results with `rich` for formatted output

## Data Cleaning Rules

- **Languages**: Skip rows where ISO_639-1_Is_Duplicate = "Y". Trim whitespace. Handle formula cells (Hash_ID contains Excel formulas — ignore).
- **Countries**: Skip rows with empty country name. Extract continent_name and continent_code.
- **Centuries**: Parse from Validation_Fields column H. Compute start/end years (e.g., "19th Century" → 1800–1899, "19th/20th Century" → 1800–1999).
- **Work_Types / Contribution_Types**: Direct mapping, generate slugs.
- **Sources**: Direct mapping from URLs sheet.

## Implementation Steps

- [ ] Create `scripts/ingest/seed_reference.py`
- [ ] Add CLI entry point with Click
- [ ] Implement per-table seed functions
- [ ] Add `--dry-run` and `--table` flags
- [ ] Test with `uv run python -m scripts.ingest.seed_reference --dry-run`
- [ ] Run full seed: `uv run python -m scripts.ingest.seed_reference`
- [ ] Verify data in Drizzle Studio (`pnpm db:studio`)

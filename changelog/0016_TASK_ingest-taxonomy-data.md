# Task 0016: Ingestion — Seed Taxonomy Data

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0009, 0010, 0011, 0012, 0013, 0014
**Blocks**: 0019, 0020

## Overview

Create a Python ingestion script to seed all taxonomy/classification tables from the knowledge base Excel file. These are the hierarchical and flat classification systems that works will be tagged with during book ingestion.

## Tables to Seed

| Table | Source Sheet | Rows | Hierarchy | Notes |
|-------|-------------|------|-----------|-------|
| `book_categories` | Book_Categories | 825 | 3-level (Category_1 > Category_2 > Category_3) | Largest taxonomy; needs parent-child resolution |
| `literary_movements` | Literary_Movements | 217 | 3-level (Era > Movement > Sub-movement) | Self-referential hierarchy |
| `themes` | Themes | 567 | 3-level (Category > Subcategory > Theme) | Self-referential hierarchy |
| `art_types` | Art_Types | 170 | Flat | Filter to literature-related types |
| `art_movements` | Art_Movements | 86 | Flat | Deduplicate |
| `keywords` | Keywords | 287 | Flat | Simple name list |
| `attributes` | Attributes | 70 | Flat with category | Name + Description + Category |
| `subjects` | Subjects | 238 | Flat with description | Extends existing subjects table (add missing + update descriptions) |

## Source File

`/home/pabloagn/dev/phantom/src/packages/phantom-canon/data/knowledge_base.xlsx`

## Script Location

`scripts/ingest/seed_taxonomy.py`

## Implementation Details

### Hierarchical Tables (Book Categories, Literary Movements, Themes)

Each hierarchical sheet has 3 columns representing levels. The approach:

1. Read all rows
2. Build a tree: each unique Level 1 value is a root node; each Level 2 under a Level 1 is a child; each Level 3 under a Level 2 is a grandchild
3. Insert top-down: roots first (parent_id=NULL), then level 2 (parent_id=root), then level 3 (parent_id=level 2)
4. Generate slugs as full paths for uniqueness (e.g., `fiction/literary-fiction/classics`)
5. Deduplicate: some rows have NULL level 2/3 (they define the parent only)

### Flat Tables

Direct insert with deduplication on name. Generate slugs.

### Art Types Filtering

The user wants "all art types associated with literature in any way, shape or form." Filter by `Applicable_Work_Type(s)` containing "Book", "Manuscript", "Essay", "Poem", "Play", or similar text-based types. Include all if uncertain — better to have too many than miss relevant ones.

### Subjects

The subjects table already exists with some data. This script should:
- Insert new subjects that don't exist yet (match on name)
- Update existing subjects with descriptions where available
- Use upsert semantics

## Data Cleaning Rules

- Skip rows where Duplicated_Entry = "Y"
- Trim whitespace from all fields
- Handle NULL/empty hierarchy levels (a row with Category_1="Fiction" and NULL Category_2/3 just defines the L1 node)
- Normalize inconsistent casing

## Implementation Steps

- [ ] Create `scripts/ingest/seed_taxonomy.py`
- [ ] Implement hierarchy builder for 3-level tables
- [ ] Implement flat table seeding
- [ ] Add `--dry-run` and `--table <name>` flags
- [ ] Test with `uv run python -m scripts.ingest.seed_taxonomy --dry-run`
- [ ] Run full seed
- [ ] Verify hierarchies in Drizzle Studio

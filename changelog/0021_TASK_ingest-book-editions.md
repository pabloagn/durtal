# Task 0021: Ingestion — Book Editions (Additional Editions for Existing Works)

**Status**: Not Started
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0019
**Blocks**: None

## Overview

Ingest additional book editions from the Book_Editions sheet. These are extra editions of books that already exist in the system (from the main Books ingestion in Task 0019). Each row represents a different edition (different publisher, year, ISBN, or translation) of an existing work.

## Source Data

- **Book_Editions**: `knowledge_base.xlsx` → `Book_Editions` sheet (114 rows, 11 columns)

### Column Mapping

| Excel Column | → Durtal Field | Notes |
|-------------|----------------|-------|
| `Hash_ID` | — | May be formula or null |
| `Hash_ID_Books` | — | Links back to Books sheet (for work resolution) |
| `Title` | Work lookup key | Match to existing work title |
| `Author` | Work lookup key | Match to existing work author |
| `Edition` | `publication_year` or `edition_name` | Often a year (e.g., 2010) |
| `Publisher` | `publisher` | |
| `Edition_Title` | `title` | Title as printed on this edition (if different) |
| `Published_Title` | `title` (fallback) | |
| `Published_Language` | `language` | |
| `Published_Date` | `publication_year` | |
| `ISBN13` | `isbn_13` | |

## Script Location

`scripts/ingest/seed_editions.py`

## Implementation Details

### Work Resolution

Each edition row must be linked to an existing work:
1. Match by Title + Author against `works` table (joined with `work_authors` and `authors`)
2. If no match found, log a warning and skip (the parent work should have been created in Task 0019)
3. Handle author name format ("Surname, Name" in the Excel vs. "Name Surname" in the database)

### Edition Creation

- Create a new `editions` row under the matched work
- Set `title` from Edition_Title or Published_Title (fall back to work title)
- Set `publisher`, `publication_year`, `language`, `isbn_13`
- The `Edition` column may contain a year — map to `publication_year` or `edition_name` depending on content

### Deduplication

- Before creating, check if an edition with the same ISBN13, or same publisher + year combination, already exists under this work
- Skip duplicates

## Implementation Steps

- [ ] Create `scripts/ingest/seed_editions.py`
- [ ] Implement work resolution by title + author
- [ ] Implement edition creation with field mapping
- [ ] Implement deduplication checks
- [ ] Add `--dry-run` flag
- [ ] Test and run
- [ ] Verify new editions are correctly linked to works

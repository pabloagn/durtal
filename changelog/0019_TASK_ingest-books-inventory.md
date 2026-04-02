# Task 0019: Ingestion — Core Books Inventory

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0006, 0015, 0016, 0017, 0018
**Blocks**: 0021

## Overview

Ingest the main books inventory (3905 rows) from the knowledge base into Durtal's three-tier model: Works → Editions → Instances. This is the largest and most complex ingestion task. Each book row must be decomposed into the correct tier, with all metadata mapped and all relationships (author, series, locations) properly linked.

## Source Data

- **Books**: `knowledge_base.xlsx` → `Books` sheet (3905 rows, 41 columns)

### Key Column Mapping

| Excel Column | → Durtal Tier | → Field | Notes |
|-------------|---------------|---------|-------|
| `Title` | Work | `title` | Canonical title |
| `Author` | Work → Author | FK via `work_authors` | Look up or create author |
| `Series` | Work | `series_id` | Look up or create series |
| `Series_Number` | Work | `series_position` | Position in series |
| `Published_Date` | Edition | `publication_year` | May be a year or range |
| `Edition` | Edition | `edition_name` | Edition descriptor |
| `Publisher` | Edition | `publisher` | Free text (also link to `publishing_houses` if match found) |
| `Published_Title` | Edition | `title` | Title as published (if different from work title) |
| `Published_Language` | Edition | `language` | |
| `Page_Count` | Edition | `page_count` | |
| `Description_GenAI` | Work | `description` | AI-generated description |
| `Rating` | Work | `rating` | 0–5 scale |
| `Read` | (derived) | — | Y/N, informational |
| `Book_Type` | Work | `work_type_id` | Match to work_types table |
| `Temporary Tags` | Work | → tags/keywords | Parse and link |
| `Tradition` | Work | → literary_movements/themes | Parse and link |
| `Notes` | Work | `notes` | Personal notes |
| `Priority` | Work | `catalogue_status` | Map to wishlist/catalogued |
| `Cover_RAW` | Edition | `cover_source_url` | Raw cover image URL |
| `Cover_FTD` | Edition | — | Processed cover (if available) |
| `Goodreads_URL` | Edition | `goodreads_id` | Extract ID from URL |
| `Hardcover_URL` | Edition | — | Store as metadata |

### Location/Instance Columns

| Excel Column | → Instance Location | Format |
|-------------|---------------------|--------|
| `Library_Physical_MEX` | Mexico City | Y/N → create physical instance |
| `Library_Physical_EUR` | Amsterdam | Y/N → create physical instance |
| `Library_Digital_Main` | Calibre | Non-null → create digital instance |
| `Library_Mobile_Kindle` | Kindle | Non-null → create digital instance |
| `Library_Mobile_iPad` | (digital) | Non-null → create digital instance |
| `Library_Mobile_iPhone` | (digital) | Non-null → create digital instance |

## Script Location

`scripts/ingest/seed_books.py`

## Implementation Details

### Three-Tier Decomposition

For each row in the Books sheet:

1. **Work**: Create or find a work by title + author combination
   - Set `title`, `original_language` (infer from context), `description`, `rating`, `notes`, `catalogue_status`
   - Link to author via `work_authors` (look up author by name in `authors` table)
   - Link to series via `series_id` (look up or create series)
   - Link to work_type via `work_type_id`

2. **Edition**: Create an edition under the work
   - Set `title` (use Published_Title if available, else work title)
   - Set `publisher`, `publication_year`, `language`, `page_count`, `edition_name`
   - Set `cover_source_url` from Cover_RAW
   - Extract and set `goodreads_id` from Goodreads_URL

3. **Instances**: For each location column that is "Y" or non-null, create an instance
   - Look up location by name mapping:
     - Library_Physical_MEX → "Mexico City" location
     - Library_Physical_EUR → "Amsterdam" location
     - Library_Digital_Main → "Calibre" location
     - Library_Mobile_Kindle → "Kindle" location
   - Set `format` based on location type (physical → infer from context, digital → infer from location)

### Catalogue Status Mapping

- If any location column has "Y" or data → `catalogue_status = 'catalogued'`
- If `Priority` column has a value but no locations → `catalogue_status = 'wishlist'`
- Default: `catalogue_status = 'catalogued'`

### Author Resolution

1. Parse `Author` field (may contain "Surname, Name" format)
2. Look up in `authors` table by `sort_name` or `name`
3. If not found, create a minimal author record (name + sort_name only)
4. Link via `work_authors` with role `'author'`

### Series Resolution

1. If `Series` column is non-null, look up in `series` table by title
2. If not found, create a new series record
3. Set `works.series_id` and `works.series_position` from Series_Number

### Deduplication

- Check `Duplicated_Entry` column — skip rows flagged "Y"
- Before creating a work, check if it already exists (title + author match)
- If work exists, check if this edition already exists (publisher + year match)
- Upsert logic for works, insert-only for editions and instances

### Computed/Formula Columns

Several columns contain Excel formulas (Hash_ID, Duplicated_Entry, Published_Date_Decade, Published_Date_Century, Composite_*). These need to be computed from raw values, not read as formulas.

## Data Volume

- ~3905 books → ~3905 works + ~3905 editions + variable instances
- Estimated total DB rows: ~12,000–15,000

## Implementation Steps

- [ ] Create `scripts/ingest/seed_books.py`
- [ ] Implement Excel row → Work/Edition/Instance decomposition
- [ ] Implement author resolution with fuzzy matching
- [ ] Implement series resolution
- [ ] Implement location/instance creation
- [ ] Implement catalogue_status mapping
- [ ] Add `--dry-run`, `--limit <n>`, `--offset <n>` flags
- [ ] Test with `uv run python -m scripts.ingest.seed_books --dry-run --limit 20`
- [ ] Run full ingestion in batches
- [ ] Verify counts: works, editions, instances per location
- [ ] Log statistics and unresolved references

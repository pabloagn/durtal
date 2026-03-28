# Task 0020: Ingestion — Occult Library Collection

**Status**: Not Started
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0009, 0015, 0016, 0018
**Blocks**: None

## Overview

Ingest the occult library catalogue (663 books) from the knowledge base. This is a separate, curated collection of occult, esoteric, and mystical texts with its own hierarchical categorization. These books should be ingested as works with editions, tagged with the occult categories, and marked as wishlist items (since they represent a desired occult library, not necessarily owned copies).

## Source Data

- **Occult_Library**: `knowledge_base.xlsx` → `Occult_Library` sheet (663 rows, 13 columns)

### Column Mapping

| Excel Column | → Durtal Tier | → Field | Notes |
|-------------|---------------|---------|-------|
| `Entry_Number` | — | — | Sequential number, informational |
| `Category_01` | Work | → `book_categories` or collection | Top-level occult category |
| `Category_01_Number` | — | — | Ordering within category |
| `Category_02` | Work | → `book_categories` | Sub-category |
| `Category_02_Number` | — | — | Ordering within sub-category |
| `Title` | Work | `title` | Book title |
| `Author` | Work → Author | FK via `work_authors` | Author name |
| `Edition/Translation` | Edition | `edition_name` / contributor | Translation/edition info |
| `Edition_Language` | Edition | `language` | Language of this edition |
| `Original_Language` | Work | `original_language` | Original language of the work |
| `Type` | Work | → `art_types` or `work_types` | "Primary Source", "Commentary", etc. |
| `Description` | Work | `description` | Brief description |
| `Notes` | Work | `notes` | Context and significance notes |

### Occult Categories (Category_01 values)

These are the top-level categories in the occult library:
- Primal Origins & Proto-Magical Cosmologies
- Hermeticism & the Prisca Theologia
- Kabbalah & Jewish Mysticism
- Medieval & Renaissance Grimoires
- (and more)

## Script Location

`scripts/ingest/seed_occult.py`

## Implementation Details

### Work Creation

- Each row creates a Work with `catalogue_status = 'wishlist'` (these are desired books, not necessarily owned)
- Exception: if a matching book already exists in the system (from Task 0019 Books ingestion), link to that work instead of creating a duplicate and keep its existing catalogue_status
- Set `description` and `notes` from the respective columns
- Map `Original_Language` to `original_language` (ISO 639-1 lookup)

### Edition Creation

- Create one edition per row
- Map `Edition_Language` to `language`
- Parse `Edition/Translation` field: if it mentions a translator, create an edition_contributor link
  - Example: "Raymond Faulkner translation" → edition with contributor "Raymond Faulkner" role "translator"

### Author Resolution

- Authors may be "Anonymous" — handle as a special case (create or find a single "Anonymous" author)
- Parse author names (may be in various formats)
- Look up in existing `authors` table first
- Create if not found

### Category Tagging

The Category_01 and Category_02 values are specific to the occult library. Options:
1. Create these as entries in `book_categories` under an "Occult & Esoteric" parent
2. Create a dedicated collection per Category_01 value
3. Both

Recommended: Create them as `book_categories` entries AND create a "Occult Library" collection containing all ingested works.

### Deduplication Against Books Sheet

Some occult books may also appear in the main Books sheet (Task 0019). Before creating a work, check for title + author match against existing works. If found, add the occult categorization to the existing work rather than creating a duplicate.

## Implementation Steps

- [ ] Create `scripts/ingest/seed_occult.py`
- [ ] Implement Excel row → Work/Edition decomposition
- [ ] Implement author resolution (including "Anonymous" handling)
- [ ] Implement edition/translation parsing for contributor extraction
- [ ] Implement category ingestion into book_categories
- [ ] Implement deduplication against existing works
- [ ] Create "Occult Library" collection and link all ingested works
- [ ] Add `--dry-run` and `--limit <n>` flags
- [ ] Test with `uv run python -m scripts.ingest.seed_occult --dry-run --limit 20`
- [ ] Run full ingestion
- [ ] Verify counts and category hierarchies

# Task 0017: Ingestion — Seed Publishing Houses and Publisher Specialties

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0007, 0015
**Blocks**: 0019

## Overview

Seed the `publishing_houses`, `publisher_specialties`, and `publishing_house_specialties` junction table from the knowledge base. Depends on the countries table being seeded first (Task 0015) so that `country_id` FK can be resolved.

## Source Data

- **Publishing_Houses**: `knowledge_base.xlsx` → `Publishing_Houses` sheet (172 rows)
  - Columns: Publishing_House, Country, Duplicated_Entry, Specialties
  - Specialties column contains semicolon-separated values referencing the specialties list
- **Publisher_Specialties**: `knowledge_base.xlsx` → `Publisher_Specialties` sheet (163 rows)
  - Columns: Name

## Script Location

`scripts/ingest/seed_publishers.py`

## Implementation Details

### Seeding Order

1. Seed `publisher_specialties` first (flat list of names)
2. Seed `publishing_houses` (resolve country → `country_id` via lookup)
3. Parse each publisher's `Specialties` field (semicolon-separated), match to `publisher_specialties` rows, insert into `publishing_house_specialties` junction table

### Specialty Matching

The Specialties column on Publishing_Houses contains values like "Occult Literature; Esoteric Studies". These are semicolon-separated and should match against `publisher_specialties.name`. Some specialties in the publisher data may be compound (e.g., "Academic Publishing; Scholarly Works" is a SINGLE specialty name, not two). Match against the specialties table exactly.

### Country Resolution

Match Publishing_Houses.Country against `countries.name` to get `country_id`. If no match found, store the country name as free text in the `country` column and leave `country_id` as NULL.

## Data Cleaning Rules

- Skip rows where Duplicated_Entry = "Y"
- Trim whitespace
- Case-sensitive specialty matching (normalize to title case if needed)

## Implementation Steps

- [ ] Create `scripts/ingest/seed_publishers.py`
- [ ] Seed publisher_specialties (flat list)
- [ ] Seed publishing_houses with country resolution
- [ ] Parse and link specialties via junction table
- [ ] Add `--dry-run` flag
- [ ] Test and verify

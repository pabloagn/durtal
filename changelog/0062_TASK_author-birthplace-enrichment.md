# Task 0062: Author Birthplace Data Enrichment Pipeline

**Status**: Not Started
**Created**: 2026-03-30
**Priority**: MEDIUM
**Type**: Infrastructure
**Depends On**: 0059
**Blocks**: None

## Overview
Create an enrichment pipeline that automatically populates author birthplace and deathplace data by querying external sources. This seeds the `places` table (Task 0059) and links authors via `birthPlaceId` and `deathPlaceId`, enabling the Authors Map (Task 0058) to show granular locations from the start.

## Data Sources (in priority order)

### 1. Wikidata (primary, free, structured)
- Query Wikidata SPARQL endpoint for authors by name or existing `openLibraryKey`/`goodreadsId`
- Properties:
  - `P19` (place of birth) → includes coordinates, hierarchy
  - `P20` (place of death) → includes coordinates, hierarchy
  - `P625` (coordinates of the place itself)
- Wikidata provides place hierarchy (city → region → country) and coordinates natively
- Match authors by name + birth year for disambiguation
- Store `wikidataId` on the `places` records for cross-referencing

### 2. OpenLibrary API (supplementary)
- If author has `openLibraryKey`, fetch `/authors/{key}.json`
- Contains `birth_date`, `death_date`, sometimes `bio` with birthplace mention
- Less structured than Wikidata but useful for cross-validation

### 3. Tavily Search API (fallback for obscure authors)
- For authors not found in Wikidata or OpenLibrary
- Search "Author Name birthplace" via Tavily
- Parse results to extract city/country
- Requires human review flag since results are less reliable
- API key stored in `.env.local` as `TAVILY_API_KEY`

### 4. GeoNames (geocoding, free)
- For converting place names to coordinates when Wikidata doesn't provide them
- Batch lookup of place names to get lat/lng
- GeoNames username stored in `.env.local` as `GEONAMES_USERNAME`

## Pipeline Architecture

### Script location
`scripts/enrich/` directory (Python, following existing pattern in `scripts/ingest/`)

### Pipeline steps

#### Step 1: Identify authors needing enrichment
```sql
SELECT id, name, first_name, last_name, birth_year, death_year,
       open_library_key, goodreads_id
FROM authors
WHERE birth_place_id IS NULL
```

#### Step 2: Query Wikidata
- For each author, construct SPARQL query matching by name and approximate birth year
- Extract birth place, death place, coordinates
- Handle disambiguation (multiple results for common names)
- Store match confidence score

#### Step 3: Create/link places
- For each resolved birthplace:
  1. Check if `places` record already exists (by name + parent or by `wikidataId`)
  2. If not, create the full hierarchy: city → region → country
  3. Set coordinates from Wikidata or GeoNames fallback
  4. Link `author.birthPlaceId` to the place
- Same for deathplace → `author.deathPlaceId`

#### Step 4: Fallback enrichment
- Authors not found in Wikidata → try OpenLibrary
- Still not found → try Tavily search (flag as `needs_review`)
- Still not found → log and skip (user can add manually)

### Execution modes
```bash
# Dry run -- show what would be enriched, no DB writes
uv run python -m scripts.enrich.authors --dry-run

# Full enrichment of all un-enriched authors
uv run python -m scripts.enrich.authors --all

# Single author by name or ID
uv run python -m scripts.enrich.authors --author "Marcel Proust"
uv run python -m scripts.enrich.authors --author-id <uuid>

# Only use Wikidata (skip Tavily fallback)
uv run python -m scripts.enrich.authors --all --source wikidata

# Review mode: show Tavily-sourced results for manual approval
uv run python -m scripts.enrich.authors --review
```

### Rate limiting and safety
- Wikidata SPARQL: 1 request/second (their guideline)
- Tavily: respect API rate limits
- GeoNames: 1 request/second (free tier)
- All enrichment is additive -- never overwrites existing `birthPlaceId`/`deathPlaceId`
- `--force` flag to re-enrich already-populated authors
- Progress tracking: log which authors were enriched, skipped, or failed
- Dry run mode prints changes without writing

## Country Centroid Seeding

As part of this task, also backfill `countries.latitude` and `countries.longitude` using standard ISO 3166 country centroid data:
- Source: well-established public datasets (e.g., Google's country centroid dataset or Natural Earth)
- One-time migration script
- This provides fallback coordinates for authors with nationality but no birthplace

## Output
- Updated `authors` records with `birthPlaceId` and `deathPlaceId`
- New `places` records with full hierarchies and coordinates
- Updated `countries` records with centroid coordinates
- Enrichment log: `scripts/enrich/logs/authors_enrichment_YYYY-MM-DD.json`

## Future: UI-triggered enrichment
- In a future iteration, add an "Enrich" button on the author detail page
- Triggers the same pipeline for a single author via an API route
- Shows results for user approval before saving

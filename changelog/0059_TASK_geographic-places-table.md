# Task 0059: Geographic Places Table and Author Location Links

**Status**: Not Started
**Created**: 2026-03-30
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0058, 0060

## Overview
Create a proper geographic `places` table to store locations at any granularity level (country, region, city, town, village, neighborhood). Link authors to places via `birthPlaceId` and `deathPlaceId`. This is the foundational schema for the Authors Map (Task 0058) and can also serve the Provenance Pipeline (Task 0060) for geographic flow visualization.

The existing `locations` table is for physical/digital storage locations (shelves, Kindle, etc.) -- it is NOT for geographic places and must remain separate.

## Schema Changes

### New table: `places`

```
places
  id              uuid, PK, default random
  name            text, NOT NULL          -- "Auteuil", "Paris", "Île-de-France", "France"
  fullName        text                    -- precomputed: "Auteuil, Paris, Île-de-France, France"
  type            text, NOT NULL          -- enum: country | region | state | province | city | town | village | district | neighborhood
  parentId        uuid, FK → places       -- hierarchical self-reference (Auteuil → Paris → Île-de-France → France)
  countryId       uuid, FK → countries    -- quick link to country for filtering/fallback
  latitude        double precision        -- precomputed, WGS84
  longitude       double precision        -- precomputed, WGS84
  geonameId       integer                 -- GeoNames database reference for enrichment
  wikidataId      text                    -- Wikidata Q-identifier for cross-referencing
  createdAt       timestamptz, default now()

  UNIQUE(name, parentId)                  -- no duplicate names within same parent
```

### Authors table additions

Add to `src/lib/db/schema/authors.ts`:
- `birthPlaceId` (uuid, FK → places, nullable, SET NULL)
- `deathPlaceId` (uuid, FK → places, nullable, SET NULL)

The existing `nationalityId` → `countries` remains (nationality ≠ birthplace -- Kafka was born in Prague but is considered Czech/Austrian/German depending on context).

### Countries table additions

Add precomputed centroid coordinates (fallback for authors without a specific birth place):
- `latitude` (double precision, nullable)
- `longitude` (double precision, nullable)

### Relations
- `places` → self-referential parent (hierarchy)
- `places` → `countries` (quick country link)
- `authors.birthPlaceId` → `places`
- `authors.deathPlaceId` → `places`

## Coordinate Resolution Algorithm

For the map (Task 0058), the algorithm to get an author's map coordinates:

```
1. If author.birthPlaceId is set:
   → Use places.latitude, places.longitude
2. Else if author.nationalityId is set:
   → Use countries.latitude, countries.longitude (centroid)
3. Else:
   → Author is unmapped (excluded from map, shown in sidebar)
```

## Coordinate Precomputation

Coordinates must be stored, never computed at render time:

### For the `countries` table backfill
- Use standard ISO 3166 country centroid dataset (freely available, well-established)
- Populate `latitude` and `longitude` for all existing countries in a migration

### For the `places` table
- When creating a new place, coordinates can be:
  1. **Manually entered** by the user
  2. **Looked up via geocoding API** (Mapbox Geocoding or OpenStreetMap Nominatim) and stored once
  3. **Referenced from GeoNames** free dataset (11M+ places with coordinates)
- A utility function should support geocoding lookup during place creation (optional, user can override)
- Once stored, coordinates are never re-fetched unless explicitly requested

### Place hierarchy construction
- When a place is created with a parent, the `fullName` is computed: "name, parent.name, grandparent.name, ..."
- When a parent changes, children's `fullName` values are recomputed
- The `countryId` is inherited from the nearest ancestor of type 'country', or set explicitly

## Migration Plan
1. Create `places` table
2. Add `latitude`, `longitude` to `countries` table
3. Backfill country coordinates from standard dataset
4. Add `birthPlaceId`, `deathPlaceId` to `authors` table
5. Update `docs/02_DATA_MODEL.md`

## Server Actions
- `createPlace(input)` -- with optional geocoding lookup
- `updatePlace(id, input)`
- `deletePlace(id)` -- only if no authors reference it
- `searchPlaces(query)` -- for autocomplete in author edit forms
- `getPlaceHierarchy(id)` -- returns full parent chain
- `getOrCreatePlaceChain(names[])` -- given ["Auteuil", "Paris", "Île-de-France", "France"], creates the full hierarchy if it doesn't exist

## UI Integration
- Author edit dialog gets a new "Birth Place" and "Death Place" field
- These are autocomplete/search fields backed by `searchPlaces()`
- If the place doesn't exist, the user can create it inline (name + type, with optional geocoding)
- The field displays the full place name: "Auteuil, Paris, Île-de-France, France"

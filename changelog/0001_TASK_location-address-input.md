# Task 0001: Multi-Mode Location Address Input

**Status**: In Progress
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

Extend the location model and UI to support rich address entry via three input modes: manual form, postal code auto-fill, and interactive map pin. All three modes populate the same underlying address fields. Only applies to physical locations — digital locations skip address entry entirely.

## Schema Changes

Add the following columns to the `locations` table:

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `street` | text | yes | Street address line |
| `region` | text | yes | State, province, or region |
| `postal_code` | text | yes | Postal / ZIP code |
| `latitude` | double precision | yes | For map display and pin |
| `longitude` | double precision | yes | For map display and pin |

Existing `city` and `country` columns remain unchanged. `country` should store the full country name (display-friendly); add a `country_code` (text, nullable) column for ISO 3166-1 alpha-2 codes used by Nominatim.

## External Dependencies

### NPM Packages
- `leaflet` + `react-leaflet` — interactive map component
- `@types/leaflet` — TypeScript types

### External APIs (no API key required)
- **Nominatim (OpenStreetMap)** — forward and reverse geocoding, postal code lookup
  - Rate limit: 1 req/sec, must set a custom `User-Agent`
  - Usage policy: https://operations.osmfoundation.org/policies/nominatim/

### Map Tiles
- **Carto Dark Matter** — free dark-themed tiles, fits the gothic-minimal aesthetic
  - URL template: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`

## Implementation Plan

### Phase 1 — Schema and Backend

- [ ] **1.1** Add new columns to `src/lib/db/schema/locations.ts` (`street`, `region`, `postalCode`, `latitude`, `longitude`, `countryCode`)
- [ ] **1.2** Generate Drizzle migration (`pnpm db:generate`) and apply (`pnpm db:migrate`)
- [ ] **1.3** Update `docs/01_SPECS.md` locations table definition to match new schema
- [ ] **1.4** Update types in `src/lib/types/index.ts` (types auto-infer from schema, but verify composite types)
- [ ] **1.5** Update `createLocation` and `updateLocation` server actions in `src/lib/actions/locations.ts` to accept new fields
- [ ] **1.6** Add location validation schema in `src/lib/validations/locations.ts` (Zod, matching new fields)

### Phase 2 — Geocoding API Route

- [ ] **2.1** Create `src/app/api/geocode/route.ts` — server-side proxy to Nominatim
  - `GET /api/geocode?mode=postal&country=NL&postalcode=1012` — postal code lookup
  - `GET /api/geocode?mode=reverse&lat=52.37&lon=4.89` — reverse geocode (map pin to address)
  - `GET /api/geocode?mode=search&q=Amsterdam` — free-text search for map
- [ ] **2.2** Implement rate limiting (simple in-memory throttle, 1 req/sec to Nominatim)
- [ ] **2.3** Normalize Nominatim responses into a consistent `GeocodingResult` type: `{ street, city, region, country, countryCode, postalCode, lat, lon }`

### Phase 3 — UI Components

- [ ] **3.1** Install `leaflet`, `react-leaflet`, `@types/leaflet`
- [ ] **3.2** Create `src/components/locations/address-manual-form.tsx` — form fields for street, city, region, country, postal code (pure controlled inputs)
- [ ] **3.3** Create `src/components/locations/address-postal-lookup.tsx` — country selector + postal code input with "Look up" button; on success, fills all address fields
- [ ] **3.4** Create `src/components/locations/address-map-picker.tsx` — Leaflet map with Carto Dark Matter tiles, click-to-pin, reverse geocode on pin drop, optional search bar overlay
- [ ] **3.5** Create `src/components/locations/address-input.tsx` — wrapper component with segmented tab control (Manual | Postal Code | Map) that switches between the three modes; all modes write to the same shared address state
- [ ] **3.6** Add Leaflet CSS import (either in `src/app/layout.tsx` or scoped to the map component via dynamic import with `ssr: false`)

### Phase 4 — Integration

- [ ] **4.1** Refactor `src/app/locations/actions.tsx` (the LocationActions client component) to use the new `AddressInput` component inside the creation dialog; only show address section when type is "physical"
- [ ] **4.2** Add location editing dialog (currently missing) that also uses `AddressInput`
- [ ] **4.3** Update location display on `src/app/locations/page.tsx` to show full address (street, city, region, postal code, country) instead of just city/country
- [ ] **4.4** If lat/lon are stored, show a small static map thumbnail on the location card (optional, low priority)

### Phase 5 — Verification

- [ ] **5.1** Run `pnpm typecheck` — no errors
- [ ] **5.2** Run `pnpm lint` — no errors
- [ ] **5.3** Run `pnpm build` — production build succeeds
- [ ] **5.4** Manual test: create a physical location via each of the three input modes
- [ ] **5.5** Manual test: create a digital location and confirm address section is hidden
- [ ] **5.6** Manual test: edit an existing location and change its address

## Technical Notes

- Leaflet must be dynamically imported with `next/dynamic` and `ssr: false` — it accesses `window` and breaks SSR.
- Nominatim requires a descriptive `User-Agent` header (e.g., `Durtal/1.0 (personal book catalogue)`). Never call Nominatim from the client; always proxy through the API route.
- The Carto Dark Matter tile layer has no API key requirement. Attribution is required: `&copy; OpenStreetMap contributors &copy; CARTO`.
- Postal code lookups work best with a country code constraint. The country selector should populate `countryCode` (alpha-2) which is passed to Nominatim's `countrycodes` parameter.
- All address fields are optional — a location can exist with just a name and type (important for backwards compatibility with existing seed data).

## Files Created

- `src/app/api/geocode/route.ts`
- `src/lib/validations/locations.ts`
- `src/components/locations/address-input.tsx`
- `src/components/locations/address-manual-form.tsx`
- `src/components/locations/address-postal-lookup.tsx`
- `src/components/locations/address-map-picker.tsx`

## Files Modified

- `src/lib/db/schema/locations.ts` — add columns
- `src/lib/actions/locations.ts` — accept new fields
- `src/lib/types/index.ts` — verify types
- `src/app/locations/actions.tsx` — integrate AddressInput
- `src/app/locations/page.tsx` — display full address
- `docs/01_SPECS.md` — update locations table definition
- `drizzle/` — new migration file (auto-generated)

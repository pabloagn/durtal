# Task 0061: Places Tab (Venues and Establishments)

**Status**: Not Started
**Created**: 2026-03-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0059
**Blocks**: 0060

## Overview
Create a new top-level "Places" page at `/places` in the main navigation. This is a personal directory of real-world establishments the user cares about: bookshops, cafes, libraries, museums, galleries, markets, book fairs, online stores, and more. Not just acquisition sources -- these are the places that form the user's literary geography.

Some places happen to be where books are purchased (and link to orders in Task 0060), but many are simply beloved spots worth remembering and revisiting.

Integrates with Google Places API for discovering and auto-filling establishment details.

## Naming Distinction

- **`places` table** (Task 0059): Geographic locations -- hierarchical, abstract (country → region → city → town). Infrastructure for coordinates and maps.
- **`venues` table** (this task): Named establishments -- bookshops, cafes, libraries. User-facing, displayed on the `/places` page. Each venue links to a geographic `places` record for its physical location.

The UI page is called "Places" (user-friendly), backed by the `venues` DB table (avoids collision with the geographic `places` table).

## Schema Changes

### New table: `venues`

```
venues
  id                uuid, PK, default random
  name              text, NOT NULL              -- "Shakespeare and Company", "Strand Bookstore", "Café de Flore"
  slug              text, UNIQUE
  type              text, NOT NULL              -- venue_type enum
  subtype           text                        -- finer classification: "antiquarian", "independent", "chain", "specialty", etc.
  description       text                        -- personal description / what makes this place special (max 5000)

  -- Web presence
  website           text                        -- primary URL
  instagramHandle   text                        -- Instagram (many bookshops are Instagram-first)
  socialLinks       jsonb                       -- { twitter: "...", facebook: "...", etc. }

  -- Physical location
  placeId           uuid, FK → places, nullable -- geographic location (Task 0059)
  formattedAddress  text                        -- full formatted address from Google Places
  googlePlaceId     text                        -- Google Places ID for updates/enrichment
  phone             text
  email             text

  -- Operating info
  openingHours      jsonb                       -- structured hours from Google Places or manual entry
  timezone          text                        -- IANA timezone

  -- Visual / branding
  posterS3Key       text                        -- venue photo (storefront, interior, etc.)
  thumbnailS3Key    text                        -- small version for lists
  color             text                        -- accent color for UI

  -- Personal / collector
  isFavorite        boolean, default false
  personalRating    smallint                    -- 1-5
  notes             text                        -- personal notes, memories, tips (max 10000)
  specialties       text                        -- "rare first editions", "Japanese literature", "poetry", etc.
  tags              text[]                      -- flexible tagging: ["cozy", "rare-books", "has-cafe", "english-language"]
  firstVisitDate    date                        -- when you first discovered/visited this place
  lastVisitDate     date                        -- most recent visit

  -- Acquisition stats (denormalized, updated on order changes)
  totalOrders       integer, default 0
  totalSpent        numeric(12,2), default 0
  lastOrderDate     date

  -- Timestamps
  createdAt         timestamptz, default now()
  updatedAt         timestamptz
```

### Enum: `venue_type`
```
bookshop | online_store | cafe | library | museum | gallery | auction_house | market | fair | publisher | individual | other
```

### Relations
- `venues.placeId` → `places` (geographic location)
- `orders.venueId` → `venues` (acquisition source in Task 0060)
- `venues` → `media` (optional: extend media polymorphism to venues for gallery images)

## Google Places API Integration

### Search flow
1. User types establishment name or "bookshops near Paris" in search field
2. Debounced request to `/api/venues/search-places?q=...`
3. Server calls Google Places Text Search (biased by type: `book_store`, `cafe`, `library`, `museum`)
4. Results displayed as autocomplete with address preview and rating
5. User selects → Place Details fetched → form auto-filled:
   - Name, formatted address, phone, website
   - Opening hours
   - Coordinates → create/link `places` record
   - `googlePlaceId` stored for future enrichment
6. User can override any field before saving

### API configuration
- API key in `.env.local` as `GOOGLE_PLACES_API_KEY` (server-side only)
- Proxy route: `/api/venues/search-places`
- Rate limiting: respect Google's quotas
- Cache search results briefly to avoid redundant calls during typing

## Places Page Layout (`/places`)

### Navigation
- Top-level nav item alongside Library, Authors, Provenance
- Icon: MapPin or Store (Lucide)

### View modes (consistent with Library/Authors pattern)
1. **Grid view**: Cards with venue photo, name, type badge, location, favorite star, personal rating
2. **List view**: Compact rows with key info
3. **Map view**: All venues plotted on Mapbox map (reuses Task 0058 setup), clickable pins with venue popups

### Filters
- **Type**: multi-select (bookshop, cafe, library, etc.)
- **Favorites**: toggle to show only favorites
- **Location/Country**: filter by geographic region
- **Tags**: filter by user-defined tags
- **Has orders**: toggle to show only acquisition sources
- **Search**: free-text name search

### Sort options
- Name (A-Z)
- Most recent visit
- Most orders
- Most spent
- Rating
- Date added

## Venue Detail Page (`/places/[slug]`)

### Header
- Venue photo/poster as hero (or Google Street View if no custom photo)
- Name, type badge, location
- Favorite toggle, personal rating (interactive)
- Website link (prominent, external link icon)
- Address with "Open in Google Maps" link

### Info section
- Description / personal notes
- Specialties
- Tags
- Opening hours (formatted nicely)
- Contact: phone, email, social links
- First visit / last visit dates

### Order history section
- List of all orders from this venue
- Each showing: book poster, title, date, price, status
- Total spent at this venue
- Link to order on Provenance page

### Map section
- Small embedded Mapbox map showing the venue's pin
- Surrounding area visible

### Gallery (future)
- If media polymorphism is extended to venues: photos of the storefront, interior, etc.
- Uses the collage grid from Task 0057

## Venue Quick-Create (from Order flow)
When creating an order on the Provenance page:
1. Venue field is autocomplete → searches existing venues
2. No match → "Search with Google Places..." triggers API
3. Select result → venue created inline, linked to order
4. Or "Add manually" for minimal entry (just name + type)

## Server Actions
- `createVenue(input)` -- with optional Google Places auto-fill
- `updateVenue(id, input)`
- `deleteVenue(id)` -- block if orders reference it, or soft-delete
- `searchVenues(query, filters?)` -- for autocomplete and listing
- `searchGooglePlaces(query, type?)` -- proxy to Google Places API
- `getGooglePlaceDetails(placeId)` -- fetch full Place Details
- `getVenueWithStats(id)` -- venue + aggregated order stats
- `getFavoriteVenues()` -- quick access list
- `updateVenueStats(id)` -- recalculate denormalized counters
- `getVenuesForMap()` -- all venues with coordinates for map view

## Migration Plan
1. Create `venue_type` enum
2. Create `venues` table
3. Update `docs/02_DATA_MODEL.md`
4. No backfill (fresh feature)

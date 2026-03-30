# Task 0058: Authors Map View

**Status**: Not Started
**Created**: 2026-03-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0052, 0059
**Blocks**: None

## Overview
Add a new "Map" tab/view to the authors archive page. This is an interactive, dark-themed map displaying pinpoints for all authors at the most granular known location (city, town, village -- not just country). The map must be visually sophisticated, top-notch, and match the gothic-minimal design language. All coordinates are precomputed and stored -- no geocoding at render time.

## Map Library: Mapbox GL JS

**Decision**: Mapbox GL JS via `react-map-gl` (Mapbox v2/v3).

**Rationale**: Mapbox is the premium industry standard used by Uber, Airbnb, Stripe, The New York Times, Strava, and similar companies. It offers:
- The most beautiful built-in dark styles (Mapbox Dark, custom Studio styles)
- Full style customization via Mapbox Studio (desaturate, recolor, adjust label density)
- Built-in marker clustering with smooth animations
- Vector tiles (crisp at any zoom level)
- WebGL rendering (performant with thousands of markers)
- Best-in-class interactivity (fly-to, smooth zoom, 3D terrain if desired)
- Generous free tier (50k map loads/month)

**Requires**: Mapbox API access token (stored in `.env.local` as `NEXT_PUBLIC_MAPBOX_TOKEN`).

## Granularity Algorithm

The map must display each author at the most granular known location. Resolution priority:

1. **Birth place** (from `places` table via `author.birthPlaceId` -- Task 0059): city/town/village level with precomputed lat/lng
2. **Fallback to country centroid** (from `countries` table via `author.nationalityId`): if no birth place is known

This means:
- Marcel Proust → Auteuil, Paris (not just "France")
- An obscure author with only country known → country centroid
- An author with no location data → excluded from map (or shown in a sidebar "unmapped" list)

The algorithm is simple: `SELECT COALESCE(places.latitude, countries.latitude), COALESCE(places.longitude, countries.longitude)` with appropriate joins.

## Map Features

### Custom dark map style
- Create a custom Mapbox Studio style (or use Mapbox Dark as base) with:
  - Deeply desaturated colors
  - Muted label text matching the app's typography feel
  - Subtle terrain/water boundaries
  - No bright highway colors or neon POI markers
  - Overall feel: dark parchment, antique cartography meets gothic minimalism

### Author pins
- Custom marker design matching the design language (muted, small, 2px border radius if square)
- Subtle glow or pulse on the active/hovered pin
- Pin size or opacity can subtly encode author count at that location

### Clustering
- Cluster pins when multiple authors share the same or nearby locations
- Cluster circles show count, styled dark with muted accent color
- Smooth expand animation on cluster click (fly-to + zoom)

### Pin interaction
- **Hover**: Tooltip with author name and location name
- **Click**: Popup card showing:
  - Author portrait thumbnail (from active poster media)
  - Author name (clickable, navigates to author detail page)
  - Birth/death years
  - Location name (full hierarchy: "Auteuil, Paris, France")
  - If multiple authors at same location: scrollable list

### Controls
- Subtle dark-themed zoom controls
- Optional: minimap or location search
- Initial view: world view, auto-fitted to show all pins with padding

### Filter integration
- Map respects all active filters from the authors archive page
- If filtering by zodiac "Aries", only Aries authors appear on the map
- Filter changes smoothly update visible pins (animate in/out)

## Integration with Authors Archive
- "Map" is a new view mode alongside Grid / List / Detailed (existing pattern)
- View mode stored in URL params or localStorage
- Map container fills the content area below the filter bar
- Lazy-load Mapbox GL JS via `next/dynamic` to avoid impacting initial page load

## Visual Polish
- Smooth fly-to animations when clicking clusters or pins
- Subtle pin entrance animation on initial load (fade in from bottom)
- Map container with dark background matching the page
- Consider a subtle vignette at map edges blending into the page background
- No bright UI chrome anywhere

## Performance
- All coordinates precomputed in DB (no API geocoding calls at render time)
- Single query: authors + places + countries with coordinates
- Mapbox GL JS uses WebGL -- handles thousands of markers efficiently
- Marker clustering prevents DOM overload
- Dynamic import for map component

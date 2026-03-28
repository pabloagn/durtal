# Task 0023: UI — Series Page, Navigation Menu, and Main Page Field Extension

**Status**: Not Started
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0006, 0022
**Blocks**: None

## Overview

Add a Series section to the application: a dedicated `/series` page, a navigation menu entry, and extended fields on the main page. The current sidebar shows: Dashboard, Library, Authors, Locations, Collections, Tags, Settings. This task adds "Series" to the navigation and creates the corresponding page.

## Navigation Change

Add "Series" to the sidebar navigation between "Authors" and "Locations":

```
Dashboard
Library
Authors
Series        ← NEW
Locations
Collections
Tags
Settings
```

Icon: `library` or `layers` from Lucide (1.5px stroke, 16px).

## New Route: `/series`

### Series Index (`/series`)

- List all series in alphabetical order
- Each row shows: series title, original title (if different), number of works in the series, number of works owned
- Search bar for filtering
- Click a series to see its detail page

### Series Detail (`/series/[id]`)

- Series title (serif heading) with original title subtitle
- Description (if available)
- Ordered list of works in the series (by `series_position`):
  - Each work shows: position number, title, author, owned/wishlist status, cover thumbnail
  - Click through to work detail page (`/library/[id]`)
- Completion indicator: "X of Y volumes owned"

## Main Page Field Extension

The current main page (dashboard) fields need to be extended with:

- **Series count**: Total number of series in the catalogue
- **Series completion**: Number of complete series (all volumes owned)
- **Recently added to series**: Works recently added that belong to a series

These are additions to the existing dashboard stats, not replacements.

## Implementation Steps

- [ ] Add "Series" link to sidebar navigation component
- [ ] Create `src/app/series/page.tsx` — series index page
- [ ] Create `src/app/series/[id]/page.tsx` — series detail page
- [ ] Add series data fetching functions to `src/lib/db/queries/` or equivalent
- [ ] Add series stats to dashboard page
- [ ] Update `docs/01_SPECS.md` routes section (add `/series` and `/series/[id]`)
- [ ] Run `pnpm typecheck`
- [ ] Run `pnpm build`

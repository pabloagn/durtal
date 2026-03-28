# Task 0026: Taxonomy — Derived Ownership Computation Layer

**Status**: Not Started
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0024, 0025
**Blocks**: 0019, 0020, 0023

## Overview

Rewrite the derived ownership logic (currently section 6.4 of the data model spec) to account for the new catalogue status taxonomy (Task 0024) and instance lifecycle (Task 0025). Implement this logic as TypeScript utility functions that the UI and API layers will consume. This is the computation layer that answers the user's four fundamental questions:

1. **Do I want this book?** → `catalogue_status` on the work
2. **Do I have this book?** → Derived from active instances (status not `deaccessioned`)
3. **Do I have it physically? Where?** → Derived from active instances at physical locations
4. **Do I have it digitally? Calibre URL?** → Derived from active instances at digital locations, with `calibre_url` aggregation

None of these answers are stored as redundant fields. They are always computed from the canonical data: `works.catalogue_status`, `instances.status`, `instances.location_id`, `locations.type`, and `instances.calibre_url`.

---

## Derived Ownership Model

Given a work W, its editions E[], their instances I[], and the locations L[]:

### Ownership Status (computed, never stored)

```
Active instances = I[] WHERE status NOT IN ('deaccessioned')
Physical instances = Active instances WHERE L.type = 'physical'
Digital instances = Active instances WHERE L.type = 'digital'

IF Active instances count = 0
  → ownership_status: UNOWNED

IF Physical instances count > 0 AND Digital instances count = 0
  → ownership_status: PHYSICAL_ONLY

IF Physical instances count = 0 AND Digital instances count > 0
  → ownership_status: DIGITAL_ONLY

IF Physical instances count > 0 AND Digital instances count > 0
  → ownership_status: PHYSICAL_AND_DIGITAL
```

### Full Derived Status (combines catalogue status + ownership)

```
Given W.catalogue_status and ownership_status:

  tracked + UNOWNED
    → Display: TRACKED
    → Meaning: bibliographic record only, no intent, no copies

  shortlisted + UNOWNED
    → Display: SHORTLISTED
    → Meaning: under consideration, no copies yet

  shortlisted + any ownership
    → Display: SHORTLISTED (PARTIALLY HELD)
    → Meaning: considering further acquisition, already has some copies
    → Edge case: user has a digital copy but is considering buying physical

  wanted + UNOWNED
    → Display: WANTED
    → Meaning: actively seeking, no copies yet

  wanted + any ownership
    → Display: WANTED (PARTIALLY HELD)
    → Meaning: actively seeking more copies or different format
    → Example: has EPUB, wants hardcover

  on_order + UNOWNED
    → Display: ON ORDER
    → Meaning: acquisition in progress, nothing in hand yet

  on_order + any ownership
    → Display: ON ORDER (PARTIALLY HELD)
    → Meaning: has some copies, more on the way

  accessioned + UNOWNED
    → Display: ACCESSIONED (NO ACTIVE COPIES)
    → Meaning: all copies are in non-available states (lent, missing, in transit, in storage, damaged)
    → Important: this is NOT deaccessioned — the work is still in the collection, just no copies are currently available
    → UI: show warning indicator

  accessioned + PHYSICAL_ONLY
    → Display: OWNED — PHYSICAL
    → Detail: list of physical locations with instance counts
    → Example: "Mexico City (2), Amsterdam (1)"

  accessioned + DIGITAL_ONLY
    → Display: OWNED — DIGITAL
    → Detail: list of digital locations with Calibre URLs
    → Example: "Calibre (EPUB) → [link], Kindle (MOBI)"

  accessioned + PHYSICAL_AND_DIGITAL
    → Display: OWNED — PHYSICAL & DIGITAL
    → Detail: combined location list with format breakdown

  deaccessioned + UNOWNED
    → Display: DEACCESSIONED
    → Meaning: was once in the collection, all copies disposed
    → UI: show historical ownership summary (from deaccessioned instances)

  deaccessioned + any ownership
    → Display: DEACCESSIONED (INCONSISTENT)
    → Meaning: data integrity issue — work marked deaccessioned but active instances exist
    → UI: show warning, prompt user to resolve
```

### Location Detail (per work)

For each active instance, aggregate by location:

```
physical_locations: [
  {
    location_id, location_name, location_color, location_icon,
    instances: [
      { instance_id, format, condition, status, sub_location_name }
    ]
  }
]

digital_locations: [
  {
    location_id, location_name, location_color, location_icon,
    instances: [
      { instance_id, format, status, calibre_id, calibre_url, file_size_bytes }
    ]
  }
]
```

### Calibre URL Resolution

For works with digital instances at a Calibre location:
- If `calibre_url` is populated on the instance → use it directly
- If `calibre_id` is populated but `calibre_url` is not → construct URL from Calibre-Web base URL (stored in application settings or location metadata) + calibre_id
- If neither → no link available

---

## TypeScript Utility Functions

Located in `src/lib/utils/ownership.ts` (or similar). These are pure functions that operate on query results — they do not execute queries themselves.

### Core Functions

```
computeOwnershipStatus(instances, locations)
  → { status: 'unowned' | 'physical_only' | 'digital_only' | 'physical_and_digital',
      physicalCount: number,
      digitalCount: number,
      totalActive: number }

computeDerivedStatus(catalogueStatus, ownershipStatus)
  → { display: string, meaning: string, isInconsistent: boolean, hasWarning: boolean }

groupInstancesByLocation(instances, locations)
  → { physical: LocationGroup[], digital: LocationGroup[] }

aggregateCalibreLinks(digitalInstances)
  → { calibreUrl: string | null, calibreId: number | null, format: string }[]
```

### Query Helpers

Drizzle query fragments (not full queries) that the API routes and server components can compose:

```
withOwnershipSummary(workQuery)
  → Extends a work query with LEFT JOINs to editions → instances → locations,
     aggregating instance counts by location type

withLocationBreakdown(workId)
  → Returns the full physical_locations + digital_locations structure for a single work

withCalibreLinks(workId)
  → Returns all digital instances with Calibre URL resolution
```

---

## Spec Rewrite: Section 6.4

The current section 6.4 ("Derived Status Logic") in `docs/02_DATA_MODEL.md` must be completely rewritten to document:

1. The new derived ownership model (as specified above)
2. The full derived status matrix (catalogue_status x ownership_status)
3. The location detail aggregation logic
4. The Calibre URL resolution rules
5. Updated example queries using the new enums

### Updated Example Queries

**"Show me all books I want but don't have"**:
```sql
SELECT w.*, acquisition_priority
FROM works w
WHERE w.catalogue_status = 'wanted'
  AND NOT EXISTS (
    SELECT 1 FROM editions e
    JOIN instances i ON i.edition_id = e.id
    WHERE e.work_id = w.id
      AND i.status != 'deaccessioned'
  )
ORDER BY
  CASE w.acquisition_priority
    WHEN 'urgent' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    WHEN 'low' THEN 4
    ELSE 5
  END;
```

**"Show me all books I own physically in Mexico City"**:
```sql
SELECT DISTINCT w.*, e.title AS edition_title, i.format, i.condition
FROM works w
JOIN editions e ON e.work_id = w.id
JOIN instances i ON i.edition_id = e.id
JOIN locations l ON l.id = i.location_id
WHERE l.name = 'Mexico City'
  AND l.type = 'physical'
  AND i.status NOT IN ('deaccessioned')
  AND w.catalogue_status = 'accessioned';
```

**"Show me all books I have digitally with their Calibre links"**:
```sql
SELECT DISTINCT w.title, e.title AS edition_title,
       i.format, i.calibre_id, i.calibre_url, l.name AS platform
FROM works w
JOIN editions e ON e.work_id = w.id
JOIN instances i ON i.edition_id = e.id
JOIN locations l ON l.id = i.location_id
WHERE l.type = 'digital'
  AND i.status NOT IN ('deaccessioned')
  AND w.catalogue_status = 'accessioned';
```

**"Show me all books I own physically but not digitally"**:
```sql
SELECT DISTINCT w.*
FROM works w
JOIN editions e ON e.work_id = w.id
JOIN instances i ON i.edition_id = e.id
JOIN locations l ON l.id = i.location_id
WHERE l.type = 'physical'
  AND i.status NOT IN ('deaccessioned')
  AND w.catalogue_status = 'accessioned'
  AND NOT EXISTS (
    SELECT 1 FROM editions e2
    JOIN instances i2 ON i2.edition_id = e2.id
    JOIN locations l2 ON l2.id = i2.location_id
    WHERE e2.work_id = w.id
      AND l2.type = 'digital'
      AND i2.status NOT IN ('deaccessioned')
  );
```

**"Show me the full history of a work's status changes"**:
```sql
SELECT wsh.from_status, wsh.to_status, wsh.changed_at, wsh.notes
FROM work_status_history wsh
WHERE wsh.work_id = '{work_id}'
ORDER BY wsh.changed_at ASC;
```

**"Show me all deaccessioned books and how they left"**:
```sql
SELECT w.title, i.disposition_type, i.disposition_date,
       i.disposition_to, i.disposition_price, i.disposition_currency,
       l.name AS last_location
FROM works w
JOIN editions e ON e.work_id = w.id
JOIN instances i ON i.edition_id = e.id
JOIN locations l ON l.id = i.location_id
WHERE w.catalogue_status = 'deaccessioned'
  AND i.status = 'deaccessioned'
ORDER BY i.disposition_date DESC;
```

---

## Filter Sidebar Updates

The library view filter sidebar (spec section 5.2) must be updated:

**Status filter** (was: All, Catalogued, Wishlist, On Order):
```
All | Tracked | Shortlisted | Wanted | On Order | Accessioned | Deaccessioned
```

**Priority filter** (new):
```
All | Urgent | High | Medium | Low | No Priority
```

**Ownership filter** (new, derived):
```
All | Owned | Not Owned
  └─ Physical: Any | Mexico City | Amsterdam | ...
  └─ Digital: Any | Calibre | Kindle | Audiobook | ...
```

**Instance status filter** (new):
```
All | Available | Lent Out | In Transit | In Storage | Missing | Damaged
```

---

## Dashboard Updates

The dashboard (spec section 5.2) stats must be updated:

**Status breakdown**: count of works per `catalogue_status` value, rendered as colored badges
**Priority breakdown**: count of works in active acquisition states per `acquisition_priority`
**Ownership breakdown**: works owned physically only / digitally only / both / neither
**Location breakdown**: instance counts per location (existing, but now excludes deaccessioned)
**"Next to acquire" highlight**: top 5 `wanted` works with `acquisition_priority` = `urgent` or `high`
**"Recently deaccessioned"**: last 5 works that transitioned to `deaccessioned` (from history table)

---

## Implementation Steps

- [ ] Rewrite section 6.4 of `docs/02_DATA_MODEL.md` with the full derived ownership model
- [ ] Update section 5.2 (filter sidebar, dashboard) in the relevant docs
- [ ] Create `src/lib/utils/ownership.ts` with core computation functions
- [ ] Create Drizzle query helpers for ownership aggregation
- [ ] Add Calibre URL resolution logic
- [ ] Write unit tests for `computeOwnershipStatus`, `computeDerivedStatus`, `groupInstancesByLocation`
- [ ] Run `pnpm typecheck`
- [ ] Verify derived statuses against test data in Drizzle Studio

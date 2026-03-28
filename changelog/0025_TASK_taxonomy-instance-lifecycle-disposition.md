# Task 0025: Taxonomy — Instance Lifecycle & Disposition Tracking

**Status**: Not Started
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: 0026, 0019, 0020

## Overview

Replace the crude `is_lent_out` boolean on instances with a proper instance lifecycle status enum, add disposition tracking fields for deaccessioned copies, and add an instance status history audit table.

Currently, the only stateful information on an instance is whether it's lent out (a boolean). A real collection management system tracks the full lifecycle of every physical and digital copy: is it on the shelf, in a box, lent to someone, in transit between locations, missing, damaged, or formally removed from the collection? When a copy leaves the collection, the disposition must be recorded — how, when, to whom, for how much — so the full provenance chain is preserved.

This task operates at the **instance level** (specific copies), complementing Task 0024 which operates at the **work level** (intellectual works).

---

## Instance Status Enum: `instance_status_enum`

Seven values representing the lifecycle states of a specific physical or digital copy.

| Value | Label | Description | Lucide Icon | Color (hex) |
|-------|-------|-------------|-------------|-------------|
| `available` | Available | At its designated location, accessible. Default for all new instances. The copy is on the shelf, in the e-reader, or otherwise ready to hand. | `check-circle` | `#76946a` |
| `lent_out` | Lent Out | Currently lent to another person. The existing `lent_to` and `lent_date` fields carry the lending details. The copy is expected to return. | `share-2` | `#c0a36e` |
| `in_transit` | In Transit | Being moved between locations. The instance's `location_id` reflects the **destination**. Used when shipping books between physical locations (e.g., Mexico City → Amsterdam) or migrating digital files between platforms. | `truck` | `#648493` |
| `in_storage` | In Storage | Packed away, not readily accessible. In a moving box, archive shelf, or deep storage. The copy is still owned but not browsable. | `box` | `#586e75` |
| `missing` | Missing | Cannot be located. The copy was expected at its `location_id` but is not there. May be found later or eventually deaccessioned. Triggers a visual alert in the UI. | `search` | `#a65454` |
| `damaged` | Damaged | Needs repair, rebinding, or condition assessment before being considered available. The existing `condition` and `condition_notes` fields carry the damage details. | `alert-triangle` | `#b07d4f` |
| `deaccessioned` | Deaccessioned | This specific copy has been formally removed from the collection. The instance row is **never deleted** — it is preserved with its full history and disposition details. When all instances of a work are deaccessioned, the work's `catalogue_status` should be reviewed (may warrant changing to `deaccessioned` at the work level via Task 0024). | `x-circle` | `#7d3d52` |

**Default**: `available`

### State Transitions

As with work-level status (Task 0024), all transitions are user-initiated and unrestricted. The UI highlights natural paths but does not enforce them.

```
Typical lifecycle:
  available → lent_out → available               (lent and returned)
  available → in_transit → available              (moved between locations)
  available → in_storage → available              (packed, then unpacked)
  available → deaccessioned                       (sold, donated, lost)

Damage path:
  available → damaged → available                 (repaired)
  available → damaged → deaccessioned             (beyond repair)

Missing path:
  available → missing → available                 (found)
  available → missing → deaccessioned             (given up, formally removed)

Direct deaccessioning (from any state):
  lent_out → deaccessioned                        (gift to borrower, never returned)
  in_storage → deaccessioned                      (disposed without unpacking)
  missing → deaccessioned                         (written off)

Re-accessioning (rare but valid):
  deaccessioned → available                       (re-acquired the same copy, or error correction)
```

---

## Disposition Fields

Added to the `instances` table. Populated when `instance_status = 'deaccessioned'`. Nullable otherwise.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `disposition_type` | `disposition_type_enum` | nullable | How the copy left the collection (see enum below) |
| `disposition_date` | `DATE` | nullable | When the copy was formally removed |
| `disposition_to` | `TEXT` | nullable | Recipient: person name, institution, platform, or marketplace |
| `disposition_price` | `DECIMAL(10,2)` | nullable | Sale or trade value (if applicable) |
| `disposition_currency` | `VARCHAR(3)` | nullable | ISO 4217 currency code |
| `disposition_notes` | `TEXT` | nullable | Free-text context ("Donated to Amsterdam public library", "Water damage, unsalvageable") |

### Disposition Type Enum: `disposition_type_enum`

| Value | Label | Description |
|-------|-------|-------------|
| `sold` | Sold | Sold to a buyer (individual, bookshop, online marketplace) |
| `donated` | Donated | Given to an institution (library, school, charity) |
| `gifted` | Gifted | Given to a specific person as a gift |
| `traded` | Traded | Exchanged for another book or item |
| `lost` | Lost | Lost (misplaced permanently, lost in a move, etc.) |
| `stolen` | Stolen | Taken without consent |
| `destroyed` | Destroyed | Physically destroyed (fire, flood, deliberate disposal) |
| `returned` | Returned | Returned to lender (if the instance was borrowed, not owned) |
| `expired` | Expired | Digital license expired or revoked (DRM, subscription ended) |

---

## Replaced Fields

| Old Field | Replacement | Migration |
|-----------|-------------|-----------|
| `is_lent_out` (BOOLEAN) | `instance_status = 'lent_out'` | `WHERE is_lent_out = true` → set `instance_status = 'lent_out'`; all others → `instance_status = 'available'` |

The following fields are **retained** (they carry lending data, not status):
- `lent_to` — who has the copy
- `lent_date` — when it was lent

---

## Instance Status History Table: `instance_status_history`

Mirrors `work_status_history` (Task 0024) but for individual copies. Every instance status transition is recorded as an immutable audit log entry. Append-only.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | |
| `instance_id` | `UUID` | FK → `instances.id` ON DELETE CASCADE, NOT NULL | The instance whose status changed |
| `from_status` | `instance_status_enum` | nullable | Previous status. NULL for creation. |
| `to_status` | `instance_status_enum` | NOT NULL | New status |
| `changed_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | When the transition occurred |
| `notes` | `TEXT` | nullable | Optional context ("Lent to Carlos", "Shipped via DHL tracking #12345") |

**Indexes**:
- `instance_id` — B-tree (all transitions for an instance)
- `changed_at` — B-tree (recent transitions)
- `(instance_id, changed_at)` — composite for ordered history retrieval

---

## Schema Changes to `instances` Table

1. Create pgEnum `instance_status_enum` with values: `available`, `lent_out`, `in_transit`, `in_storage`, `missing`, `damaged`, `deaccessioned`
2. Create pgEnum `disposition_type_enum` with values: `sold`, `donated`, `gifted`, `traded`, `lost`, `stolen`, `destroyed`, `returned`, `expired`
3. Add column `status` of type `instance_status_enum`, NOT NULL, DEFAULT `'available'`
4. Add disposition columns: `disposition_type`, `disposition_date`, `disposition_to`, `disposition_price`, `disposition_currency`, `disposition_notes`
5. Create `instance_status_history` table
6. Drop column `is_lent_out` (after data migration)
7. Add index on `status` — B-tree for filtered views
8. Add partial index on `disposition_type` WHERE `status = 'deaccessioned'`

---

## Migration Strategy

**For existing data (if any):**

1. Add `status` column with default `'available'`
2. `UPDATE instances SET status = 'lent_out' WHERE is_lent_out = true`
3. Insert initial `instance_status_history` rows: `from_status = NULL`, `to_status = status`, `changed_at = instances.created_at`
4. Drop `is_lent_out` column

---

## Downstream Impact

- **Task 0019** (Ingest Books Inventory): instance creation must set `status = 'available'` (the default) and insert an initial history row.
- **Task 0020** (Ingest Occult Library): no instances are created for wishlist/wanted items, so no direct impact.
- **Any future UI work** referencing `is_lent_out` must switch to `status = 'lent_out'`.

---

## Implementation Steps

- [ ] Create pgEnum `instance_status_enum` in Drizzle schema
- [ ] Create pgEnum `disposition_type_enum` in Drizzle schema
- [ ] Update `instances` table schema: add `status`, add disposition columns
- [ ] Create `instance_status_history` table in Drizzle schema
- [ ] Generate Drizzle migration
- [ ] Write data migration: map `is_lent_out` → `status`, seed history, drop `is_lent_out`
- [ ] Update `docs/02_DATA_MODEL.md`: instances table definition, new enums, new table, disposition fields, lifecycle transitions
- [ ] Run `pnpm typecheck`
- [ ] Apply migration to Neon with `pnpm db:migrate`
- [ ] Verify in Drizzle Studio: enum values, defaults, disposition fields, history table

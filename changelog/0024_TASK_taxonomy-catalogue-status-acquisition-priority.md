# Task 0024: Taxonomy — Catalogue Status & Acquisition Priority

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: 0026, 0019, 0020

## Overview

Redesign the work-level `catalogue_status` field from a weak free-text column with three values (`catalogued`, `wishlist`, `on_order`) into a proper collection management lifecycle grounded in library science terminology. Add `acquisition_priority` as a separate orthogonal dimension. Add a status history audit table to preserve the full transition history of every work.

This task addresses three fundamental deficiencies:

1. The current default (`catalogued`) implies ownership when a work might just be indexed. The correct default is `tracked` — a bibliographic record exists, nothing more.
2. The current values conflate "I want this" (`wishlist`) with the precise stage of the acquisition lifecycle. There is no distinction between "under consideration," "actively seeking," and "order placed."
3. There is no audit trail. When a work changes status, the previous state is lost forever.

---

## Catalogue Status Enum: `catalogue_status_enum`

Six values representing the full acquisition lifecycle of a work in a personal library.

| Value | Label | Description | Lucide Icon | Color (hex) |
|-------|-------|-------------|-------------|-------------|
| `tracked` | Tracked | Bibliographic record exists in the catalogue. No acquisition intent. Default for all new works. The work is known to the system — nothing more. Equivalent to a record in a library's discovery layer. | `bookmark` | `#6b7280` |
| `shortlisted` | Shortlisted | Under consideration for acquisition. On the desiderata list. The user has expressed preliminary interest but has not committed to acquiring. In library terms, this is a selection candidate. | `list-checks` | `#648493` |
| `wanted` | Wanted | Approved for acquisition. The user actively seeks to obtain this work in some form (physical, digital, or both). In library terms, this is an approved acquisition request. | `heart` | `#c0a36e` |
| `on_order` | On Order | Acquisition in progress. An order has been placed, a download has been initiated, or a copy is in transit to the user. | `package` | `#b07d4f` |
| `accessioned` | Accessioned | Formally part of the collection. The work has at least one instance (physical or digital) registered in the system. "Accessioned" is the library science term for formally adding an item to a collection — distinct from "catalogued," which merely means a bibliographic record exists (every work in Durtal is catalogued by definition). | `library` | `#76946a` |
| `deaccessioned` | Deaccessioned | Formally removed from the collection. All instances have been disposed of (sold, donated, lost, etc.). The bibliographic record and full status history are preserved indefinitely. "Deaccessioned" is the library science term for the formal process of removing an item from a collection. | `archive` | `#7d3d52` |

**Default**: `tracked`

### State Transitions

All transitions are user-initiated. The system does not enforce a specific path — any status can transition to any other status. The UI highlights the "natural next step" but never prevents an unusual transition.

```
Typical forward progression:
  tracked → shortlisted → wanted → on_order → accessioned

Deaccessioning (all instances disposed):
  accessioned → deaccessioned

Re-acquisition (want to re-obtain a previously owned work):
  deaccessioned → wanted → on_order → accessioned

Shortcuts (common, allowed):
  tracked → accessioned         Gift received, impulse buy, found
  tracked → wanted              Skip shortlisting, immediate desire
  shortlisted → accessioned     Found it unexpectedly, bought on impulse

Regression (allowed):
  shortlisted → tracked         Lost interest
  wanted → shortlisted          Deprioritized but still considering
  wanted → tracked              No longer interested at all
  on_order → wanted             Order cancelled, still want it
```

### Colour Rationale

Colours are chosen from the existing Durtal design language palette (desaturated, muted, dark-mode appropriate). They follow an intuitive temperature progression: cool/neutral for passive states, warm for active acquisition, green for collected, dark rose for removed.

---

## Acquisition Priority Enum: `acquisition_priority_enum`

A separate dimension from catalogue status. Determines urgency of acquisition for works in active acquisition states (`shortlisted`, `wanted`, `on_order`). Modelled after Linear.app's priority system: signal-bar icons with a warm colour ramp.

| Value | Label | Lucide Icon | Color (hex) | UI Rendering |
|-------|-------|-------------|-------------|--------------|
| `none` | No Priority | `minus` | `#6b7280` | Gray bar, no fill |
| `low` | Low | `signal-low` | `#648493` | One bar filled, steel blue |
| `medium` | Medium | `signal-medium` | `#c0a36e` | Two bars filled, warm gold |
| `high` | High | `signal-high` | `#b07d4f` | Three bars filled, burnt sienna |
| `urgent` | Urgent | `alert-circle` | `#a65454` | Alert icon, muted crimson |

**Default**: `none`

**Relevance rules**:
- Displayed and editable when `catalogue_status` is `shortlisted`, `wanted`, or `on_order`.
- Hidden (but preserved in DB) when `catalogue_status` is `tracked`, `accessioned`, or `deaccessioned`.
- When filtering by priority, only works in active acquisition states are included.

---

## Status History Table: `work_status_history`

Every status transition is recorded as an immutable audit log entry. This table is append-only — rows are never updated or deleted.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | |
| `work_id` | `UUID` | FK → `works.id` ON DELETE CASCADE, NOT NULL | The work whose status changed |
| `from_status` | `catalogue_status_enum` | nullable | Previous status. NULL for the initial status at work creation. |
| `to_status` | `catalogue_status_enum` | NOT NULL | New status after the transition |
| `changed_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | When the transition occurred |
| `notes` | `TEXT` | nullable | Optional user-provided reason ("Order cancelled — out of stock", "Gift from M.") |

**Indexes**:
- `work_id` — B-tree (all transitions for a work)
- `changed_at` — B-tree (recent transitions across all works)
- `(work_id, changed_at)` — composite for ordered history retrieval

---

## Schema Changes to `works` Table

1. Create pgEnum `catalogue_status_enum` with values: `tracked`, `shortlisted`, `wanted`, `on_order`, `accessioned`, `deaccessioned`
2. Create pgEnum `acquisition_priority_enum` with values: `none`, `low`, `medium`, `high`, `urgent`
3. Alter `catalogue_status` column: convert from `text` to `catalogue_status_enum`, change default from `'catalogued'` to `'tracked'`
4. Add column `acquisition_priority` of type `acquisition_priority_enum`, NOT NULL, DEFAULT `'none'`
5. Create `work_status_history` table as specified above
6. Update index on `catalogue_status` (already B-tree, just needs to reference the enum)
7. Add index on `acquisition_priority` — B-tree for filtered views

---

## Migration Strategy

The ingestion tasks (0015–0022) are all "Not Started," so the database may be empty or near-empty. The migration must handle both cases.

**Value mapping for existing data (if any):**

| Old value | New value | Rationale |
|-----------|-----------|-----------|
| `catalogued` (with instances) | `accessioned` | Has copies → formally in the collection |
| `catalogued` (without instances) | `tracked` | No copies → just a bibliographic record |
| `wishlist` | `wanted` | Acquisition intent |
| `on_order` | `on_order` | Direct mapping, no change |

**Post-migration**: insert one `work_status_history` row per existing work with `from_status = NULL`, `to_status = <migrated value>`, `changed_at = works.created_at`, `notes = 'Initial status (migrated from legacy catalogue_status)'`.

---

## Downstream Impact

The following existing tasks reference the old `catalogue_status` values and must be updated after this task is completed:

- **Task 0019** (Ingest Books Inventory): lines 88–90 map `Priority` and `Library_*` columns to `catalogued`/`wishlist`. Must change to:
  - Any `Library_*` column populated → `accessioned`
  - `Priority` column with no locations → `wanted`
  - Default → `tracked`
  - Map `Priority` column values to `acquisition_priority` (separate from status)

- **Task 0020** (Ingest Occult Library): line 53 sets all rows to `wishlist`. Must change to `wanted` (these are desired books, not mere bibliographic records).

---

## Implementation Steps

- [x] Create pgEnum `catalogue_status_enum` in Drizzle schema
- [x] Create pgEnum `acquisition_priority_enum` in Drizzle schema
- [x] Update `works` table schema: convert `catalogue_status` to enum, add `acquisition_priority`
- [x] Create `work_status_history` table in Drizzle schema
- [x] Generate Drizzle migration
- [x] Write data migration for existing rows (if any): map old values, seed history
- [x] Update `docs/02_DATA_MODEL.md`: works table definition, new enums, new table, state transition documentation
- [x] Run `pnpm typecheck` to verify all TypeScript references compile
- [x] Apply migration to Neon with `db:push`
- [x] Verify: build passes, schema in sync with Neon

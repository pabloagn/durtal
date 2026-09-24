# Task 0115: Taxonomy Management System

**Status**: Completed
**Created**: 2026-04-06
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview
Replace the flat `/tags` and `/subjects` pages with a full taxonomy management system at `/taxonomy`. Inspired by Linear.app's label management: professional, hierarchical, fully editable, color-coded, with drag-and-drop, merge support, and click-through to filtered entity views. Must be entity-agnostic (extensible beyond books to movies, paintings, etc. in the future).

---

## Architecture

### Taxonomy Families
A "family" is a category of labels. There are 10 default (system) families plus the ability to create custom ones.

**Default families** (system, non-deletable):

| Family | Slug | Table | Level | Hierarchical | Color |
|---|---|---|---|---|---|
| Subjects | `subjects` | `subjects` | work | No (flat) | Add column |
| Genres | `genres` | `genres` | edition | Yes (parent_id) | Add column |
| Tags | `tags` | `tags` | edition | No (flat) | Has column |
| Categories | `categories` | `book_categories` | work | Yes (parent_id) | Add column |
| Themes | `themes` | `themes` | work | Yes (parent_id) | Add column |
| Literary Movements | `literary-movements` | `literary_movements` | work | Yes (parent_id) | Add column |
| Art Types | `art-types` | `art_types` | work | No (flat) | Add column |
| Art Movements | `art-movements` | `art_movements` | work | No (flat) | Add column |
| Keywords | `keywords` | `keywords` | work | No (flat) | Add column |
| Attributes | `attributes` | `attributes` | work | No (flat) | Add column |

**Custom families** — user-created groups of labels (e.g., "Reading Mood", "Shelf Section", "Era"). Stored in a new unified table. Work-level by default.

### Route Structure
```
/taxonomy                                  Family overview (grid of all families)
/taxonomy/[family-slug]                    Family detail (tree/list of items)
/taxonomy/[family-slug]/[item-slug]        Item detail (entities using this item)
```

### Sidebar
- Remove "Tags" and "Subjects" entries
- Add single "Taxonomy" entry (icon: `Tags` from Lucide) at their position
- Update command palette to match

---

## Schema Changes

### 1. Add `color` column to existing tables
Add `color: text("color")` (nullable, hex string) to:
- `subjects`
- `genres`
- `book_categories`
- `themes`
- `literary_movements`
- `art_types`
- `art_movements`
- `keywords`
- `attributes`

Tags already has `color`. No migration needed for tags.

### 2. New table: `taxonomy_families`
Registry of all families (both system and custom):

```
taxonomy_families
  id            UUID PK
  name          TEXT NOT NULL UNIQUE
  slug          TEXT NOT NULL UNIQUE
  description   TEXT
  icon          TEXT                    -- Lucide icon name
  color         TEXT                    -- hex color for the family badge
  is_system     BOOLEAN DEFAULT false   -- true for the 10 defaults
  system_table  TEXT                    -- backing table name for system families
  entity_level  TEXT DEFAULT 'work'     -- 'work' | 'edition'
  hierarchical  BOOLEAN DEFAULT false   -- supports parent/child nesting
  sort_order    INTEGER DEFAULT 0
  created_at    TIMESTAMPTZ DEFAULT NOW()
```

Seed with the 10 default families on migration.

### 3. New table: `custom_taxonomy_items`
Items belonging to custom (non-system) families:

```
custom_taxonomy_items
  id            UUID PK
  family_id     UUID NOT NULL FK -> taxonomy_families(id) CASCADE
  name          TEXT NOT NULL
  slug          TEXT NOT NULL
  description   TEXT
  color         TEXT
  parent_id     UUID FK -> custom_taxonomy_items(id) SET NULL
  sort_order    INTEGER DEFAULT 0
  created_at    TIMESTAMPTZ DEFAULT NOW()

  UNIQUE (family_id, slug)
```

### 4. New junction table: `custom_taxonomy_item_works`
```
custom_taxonomy_item_works
  item_id       UUID NOT NULL FK -> custom_taxonomy_items(id) CASCADE
  work_id       UUID NOT NULL FK -> works(id) CASCADE
  PK (item_id, work_id)
```

### 5. New junction table: `custom_taxonomy_item_editions`
For custom families at edition level:
```
custom_taxonomy_item_editions
  item_id       UUID NOT NULL FK -> custom_taxonomy_items(id) CASCADE
  edition_id    UUID NOT NULL FK -> editions(id) CASCADE
  PK (item_id, edition_id)
```

---

## Server Actions

### Family Actions (`src/lib/actions/taxonomy-families.ts`)
- `getTaxonomyFamilies()` — All families with item counts (cached)
- `getTaxonomyFamily(slug)` — Single family with metadata
- `createTaxonomyFamily(input)` — Custom family creation (Zod validated)
- `updateTaxonomyFamily(id, input)` — Edit name, description, icon, color, hierarchical flag
- `deleteTaxonomyFamily(id)` — Delete custom family + all items (system families blocked)
- `reorderFamilies(ids)` — Drag-and-drop reorder

### Item Actions (unified interface across system + custom tables)
A `resolveFamilyTable(slug)` utility maps family slugs to their backing tables and junction tables. System families route to existing tables; custom families route to `custom_taxonomy_items`.

- `getTaxonomyItems(familySlug)` — All items in a family with entity counts, tree-structured for hierarchical
- `getTaxonomyItem(familySlug, itemSlug)` — Single item with entity list (works or editions)
- `createTaxonomyItem(familySlug, input)` — Create item (routes to correct table based on family)
- `updateTaxonomyItem(familySlug, itemId, input)` — Edit name, color, description, parent
- `deleteTaxonomyItem(familySlug, itemId, reassignToId?)` — Delete item, optionally reassign entities to another item first
- `mergeTaxonomyItems(familySlug, sourceId, targetId)` — Merge source into target: reassign all entity links, delete source
- `reorderTaxonomyItems(familySlug, ids)` — Drag-and-drop reorder
- `moveTaxonomyItem(familySlug, itemId, newParentId)` — Change parent (drag into another item for nesting)
- `bulkUpdateTaxonomyItems(familySlug, itemIds, input)` — Bulk color change, bulk move to parent
- `bulkDeleteTaxonomyItems(familySlug, itemIds, reassignToId?)` — Bulk delete with optional reassignment

---

## UI Components

### Page: `/taxonomy` — Family Overview
- Grid of cards, one per family (responsive: 2 cols mobile, 3 tablet, 4 desktop)
- Each card shows:
  - Family icon (Lucide) + color badge
  - Family name (serif heading)
  - Description (one line, truncated)
  - Item count + entity count (e.g. "47 items across 312 works")
  - Visual indicator for hierarchical families (tree icon)
- "Create family" button in PageHeader actions
- Drag-and-drop reorder of family cards
- Search across families
- System families have a subtle "System" badge (non-deletable indicator)
- Custom families show edit/delete in hover menu

### Page: `/taxonomy/[family-slug]` — Family Detail
**Layout**: Two-panel (resizable, like the sidebar)

**Left panel** (primary, ~70%): Item tree/list
- Back link to `/taxonomy`
- Family header: icon, name, description, color badge, item count
- Tree view for hierarchical families:
  - Collapsible nodes with indent levels (16px per level)
  - Expand/collapse all toggle
  - Drag handle on left of each row
  - Drop zones: between items (reorder), onto items (nest as child)
- Flat list for non-hierarchical families:
  - Same row component, no indent
  - Drag handles for reorder only
- Each item row:
  - Drag handle (6-dot grip icon)
  - Color dot (8px, clickable → opens inline color picker popover)
  - Name (click to navigate to item detail, double-click to inline rename)
  - Entity count badge (muted)
  - Action menu (three dots): Edit, Set color, Move to parent, Merge into..., Delete
- Top toolbar:
  - Search/filter input
  - Sort: Manual (drag order), Alphabetical, Most used, Least used, Newest
  - "+ New item" button
  - Bulk select toggle (checkbox column)
  - Bulk action bar (when items selected): Set color, Move to parent, Merge, Delete
- Empty state: illustration + "Create your first [family name]" CTA
- Keyboard shortcuts:
  - `N` — New item
  - `Enter` — Open selected
  - `Delete/Backspace` — Delete selected (with confirmation)
  - `Arrow keys` — Navigate tree
  - `Space` — Toggle selection

**Right panel** (settings, collapsible, ~30%):
- Family metadata form:
  - Name (editable for custom, read-only for system)
  - Description (editable)
  - Icon selector (Lucide icon picker or dropdown of common ones)
  - Color (color picker)
  - Entity level: "Work-level" or "Edition-level" badge (read-only for system)
  - Hierarchical: toggle (read-only for system, editable for custom)
- Danger zone (custom families only):
  - "Delete family" button with confirmation dialog
  - Confirmation requires typing family name

### Page: `/taxonomy/[family-slug]/[item-slug]` — Item Detail
- Back breadcrumb: Taxonomy > [Family] > [Item]
- Item header:
  - Color dot (large, 16px) — clickable to change
  - Name (serif, large, inline editable)
  - Description (editable, placeholder "Add a description...")
  - Parent breadcrumb (if nested): "Under: [Parent Name]" — clickable
  - Stats row: entity count, created date, last used date
- Entity grid:
  - BookCards (for work-level families) or EditionCards (for edition-level)
  - Standard responsive grid (same component as library)
  - Pagination if > 48 items
  - "View in library" link → `/library?[family]=[item-slug]`
- Related items section:
  - "Commonly used with" — top 10 other taxonomy items that appear on the same works
  - Each as clickable badge
- Actions sidebar:
  - "Merge into..." — opens MergeDialog
  - "Move to parent..." — parent selector
  - "Delete" — opens DeleteItemDialog with reassignment option

### Shared Components

#### `TaxonomyTree` (`src/components/taxonomy/taxonomy-tree.tsx`)
- Recursive tree component using `@dnd-kit/core` + `@dnd-kit/sortable`
- Props: items (tree-structured), onReorder, onMove, onSelect
- Supports keyboard navigation (arrow keys to move, Enter to open)
- Collapse/expand state persisted in localStorage
- Performance: virtualizes long lists (> 200 items)

#### `TaxonomyItemRow` (`src/components/taxonomy/taxonomy-item-row.tsx`)
- Single row: drag handle, color dot, name, count badge, action menu
- Inline rename on double-click (contentEditable or input swap)
- Active/selected states matching design language

#### `TaxonomyColorPicker` (`src/components/taxonomy/taxonomy-color-picker.tsx`)
- Popover triggered by clicking color dot
- 12 preset swatches (matching design language palette, desaturated):
  - `#7d3d52` Rose, `#c0a36e` Gold, `#5a8a6a` Sage, `#4a6d8a` Blue
  - `#6b4d7d` Plum, `#a68a5a` Amber, `#4a7d7d` Teal, `#a65a5a` Coral
  - `#7d6ba6` Lavender, `#6b7d7d` Slate, `#6b7d5a` Olive, `#8a6b5a` Copper
- "None" option to clear color
- Custom hex input at bottom
- Keyboard navigable (arrow keys, Enter to select)

#### `CreateItemDialog` (`src/components/taxonomy/create-item-dialog.tsx`)
- Fields: Name (required), Color (optional), Parent (dropdown, for hierarchical), Description (optional)
- Auto-generates slug from name
- Validates uniqueness within family

#### `MergeDialog` (`src/components/taxonomy/merge-dialog.tsx`)
- Source: current item (read-only, with count)
- Target: searchable dropdown of other items in same family
- Preview: "X works will be reassigned from [Source] to [Target]"
- Confirm button: "Merge and delete [Source]"

#### `DeleteItemDialog` (`src/components/taxonomy/delete-item-dialog.tsx`)
- Shows entity count: "This item is used by X works"
- If count > 0: "Reassign to" dropdown (optional — if not selected, links are just removed)
- Danger confirmation

#### `CreateFamilyDialog` (`src/components/taxonomy/create-family-dialog.tsx`)
- Fields: Name, Description, Icon (dropdown), Color, Entity level (work/edition), Hierarchical (toggle)
- Auto-generates slug
- Preview card showing how it'll look in the overview grid

#### `FamilyCard` (`src/components/taxonomy/family-card.tsx`)
- Card for the overview grid
- Icon + color badge + name + description + counts
- Hover: subtle elevation + action menu
- Click: navigate to family detail

---

## Library Integration

### Filter Sidebar Extension
- Each taxonomy family becomes a filter group in the library filter sidebar
- System families that are already wired (subjects, genres, tags) keep working
- Custom families added dynamically to the filter list
- URL params: `/library?subjects=existentialism&themes=death&custom-reading-mood=dark`

### Work Detail Page
- Existing taxonomy section on `/library/[slug]` continues to render badges
- Badge clicks navigate to `/taxonomy/[family]/[item]` instead of doing nothing

### Work Add/Edit Flows
- Categorization step in wizard and edit dialog continue to reference the existing taxonomy data
- Custom families appear as additional multi-select sections

---

## Migration & Rollout Plan

### Phase 1: Schema + Backend
1. Add `color` column to 9 existing taxonomy tables
2. Create `taxonomy_families`, `custom_taxonomy_items`, junction tables
3. Seed `taxonomy_families` with the 10 system entries
4. Create `resolveFamilyTable()` routing utility
5. Create all server actions (families + items)
6. Add Zod validation schemas
7. Generate + apply Drizzle migration

### Phase 2: Core UI
8. Build `TaxonomyColorPicker`, `TaxonomyItemRow`, `TaxonomyTree`
9. Build all dialog components (Create, Merge, Delete)
10. Build `/taxonomy` overview page with `FamilyCard` grid
11. Build `/taxonomy/[family-slug]` detail page with tree/list + settings panel
12. Build `/taxonomy/[family-slug]/[item-slug]` item detail page

### Phase 3: Polish + Integration
13. Add drag-and-drop (dnd-kit) for reorder + nesting
14. Add inline editing (rename, color)
15. Update sidebar and command palette navigation
16. Wire library filter sidebar to include all taxonomy families
17. Wire work detail page badges to navigate to taxonomy item detail
18. Remove old `/tags` and `/subjects` routes
19. Keyboard shortcuts

### Phase 4: Validation
20. Tests for server actions (CRUD, merge, reorder, move)
21. Tests for `resolveFamilyTable` routing
22. Typecheck, lint, full test suite pass

---

## Dependencies
- `@dnd-kit/core` + `@dnd-kit/sortable` — verify already installed from order kanban work
- Drizzle migration for schema changes

## Design Principles
- Every interaction should feel instant (optimistic updates where possible)
- Inline editing over dialogs (double-click to rename, click dot to recolor)
- Dialogs only for destructive or multi-field operations (create, merge, delete)
- Tree view should handle 500+ items without lag (virtualize if needed)
- Keyboard-first: every action reachable via keyboard
- Consistent with the gothic-minimal aesthetic: dark, muted, serif headings, 2px radius

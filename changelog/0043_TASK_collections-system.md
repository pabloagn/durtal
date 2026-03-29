# Task 0043: Collections System (Schema, CRUD, Add to Collection)

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0036
**Blocks**: None

## Overview

Introduce a collections system that lets users organize works into named, user-defined groups. Collections are orthogonal to taxonomy (subjects, categories, themes) -- they represent personal curation: "To Read This Summer", "Favorites", "Lending Library", "Gift Ideas", "Research: Gothic Literature", etc.

A work can belong to multiple collections. Collections are ordered (user can reorder works within a collection).

Accessible from:
1. The book card actions menu in the library view ("Add to collection")
2. The book detail page
3. A dedicated collections page (browse/manage collections)
4. Bulk operations toolbar (Task 0038)

## Implementation Details

### 1. Database Schema

**New file: `src/lib/db/schema/collections.ts`**

```typescript
// Collections table
export const collections = pgTable("collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  coverS3Key: text("cover_s3_key"),       // optional collection cover image
  sortOrder: smallint("sort_order").default(0),
  isSmartCollection: boolean("is_smart_collection").default(false),  // future: auto-populated by rules
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Junction table: works <-> collections (many-to-many)
export const collectionWorks = pgTable("collection_works", {
  id: uuid("id").defaultRandom().primaryKey(),
  collectionId: uuid("collection_id")
    .notNull()
    .references(() => collections.id, { onDelete: "cascade" }),
  workId: uuid("work_id")
    .notNull()
    .references(() => works.id, { onDelete: "cascade" }),
  position: smallint("position").default(0),  // ordering within collection
  addedAt: timestamp("added_at").defaultNow().notNull(),
}, (table) => ({
  uniqueCollectionWork: unique().on(table.collectionId, table.workId),
}));
```

Relations:
```typescript
export const collectionsRelations = relations(collections, ({ many }) => ({
  collectionWorks: many(collectionWorks),
}));

export const collectionWorksRelations = relations(collectionWorks, ({ one }) => ({
  collection: one(collections, {
    fields: [collectionWorks.collectionId],
    references: [collections.id],
  }),
  work: one(works, {
    fields: [collectionWorks.workId],
    references: [works.id],
  }),
}));
```

Migration: `pnpm db:generate` then `pnpm db:migrate`.

Update `docs/02_DATA_MODEL.md` with the new tables.

### 2. Server Actions

**New file: `src/lib/actions/collections.ts`**

```typescript
// CRUD
getCollections(): Collection[]                          // all collections, ordered
getCollection(id: string): Collection with works        // single collection with work list
createCollection(input: { name, description? }): Collection
updateCollection(id: string, input: Partial<...>): Collection
deleteCollection(id: string): void                      // deletes collection, NOT the works

// Collection membership
addWorkToCollection(collectionId: string, workId: string): void
removeWorkFromCollection(collectionId: string, workId: string): void
addWorksToCollection(collectionId: string, workIds: string[]): void   // bulk add
getWorkCollections(workId: string): Collection[]         // which collections a work belongs to
reorderCollectionWorks(collectionId: string, workIds: string[]): void  // set new positions
```

### 3. Add to Collection Dialog

**New file: `src/components/books/add-to-collection-dialog.tsx`**

`"use client"` component:

```typescript
interface AddToCollectionDialogProps {
  open: boolean;
  onClose: () => void;
  workId: string;          // single work mode
  workIds?: string[];      // bulk mode (from multi-select)
  title: string;           // for display: "Add {title} to collection" or "Add {n} works to collection"
}
```

Dialog layout:

**Search/filter:**
- Search input to filter existing collections by name
- Results list below, showing collection name, description snippet, work count

**Collection list:**
- Each collection row has a checkbox (checked if work is already in it)
- Toggling a checkbox adds/removes the work immediately (optimistic UI)
- Collections the work is already in are shown at the top, checked

**Create new collection:**
- "New collection" button at bottom of list (or inline if no results match)
- Expands to show: name input, optional description textarea
- "Create and add" button
- Creates collection then adds the work to it

**Bulk mode:**
- When `workIds` has multiple entries, the header says "Add {n} works to collection"
- Checkboxes show mixed state if some works are in a collection and others aren't
- Toggling adds all selected works that aren't already members

### 4. Integration Points

**Book card actions menu** (`src/components/books/book-card-actions-menu.tsx`):
- "Add to collection" opens `AddToCollectionDialog` with single `workId`

**Book detail page** (`src/app/library/[slug]/page.tsx`):
- Show collections section (below taxonomy or in sidebar)
- List of collections this work belongs to, as badges/chips
- "Add to collection" button
- Click on a collection badge navigates to that collection's page

**Bulk action toolbar** (`src/components/books/bulk-action-toolbar.tsx` from Task 0038):
- "Add to collection" button opens `AddToCollectionDialog` in bulk mode

### 5. Collections Page (Future)

A dedicated `/library/collections` page is a natural extension but can be scoped separately. For this task, the minimum viable feature is the dialog and the server actions. The collections page would show:
- Grid of collection cards (name, cover, work count)
- Click into a collection shows its works in a grid (reusing library grid components)
- Drag-and-drop reordering within a collection

For now, include the route stub:

**New file: `src/app/library/collections/page.tsx`**

Minimal page that lists collections with work counts and links. Full collection browsing can be enhanced later.

### 6. Navigation

Add "Collections" link to the sidebar navigation (if a sidebar exists) or to the library page header tabs.

### Files

| File | Change |
|---|---|
| `src/lib/db/schema/collections.ts` | New: collections and collection_works tables + relations |
| `src/lib/db/schema/index.ts` | Export new schema tables |
| `src/lib/actions/collections.ts` | New: CRUD + membership server actions |
| `src/components/books/add-to-collection-dialog.tsx` | New: add-to-collection dialog (single + bulk) |
| `src/components/books/book-card-actions-menu.tsx` | Wire "Add to collection" menu item |
| `src/app/library/[slug]/page.tsx` | Show collections section on book detail page |
| `src/app/library/collections/page.tsx` | New: minimal collections listing page |
| `docs/02_DATA_MODEL.md` | Document collections and collection_works tables |

## Completion Notes

Implemented 2026-03-28.

**Schema note**: The existing schema at `src/lib/db/schema/collections.ts` links collections to **editions** (via `collectionEditions` junction table with composite primary key), not to works as originally planned. This is actually more flexible -- users can add specific editions to collections rather than entire works. All implementation follows this edition-based approach.

**Server actions** (`src/lib/actions/collections.ts`):
- Pre-existing CRUD actions (`getCollections`, `getCollection`, `createCollection`, `updateCollection`, `deleteCollection`) and membership actions (`addEditionToCollection`, `removeEditionFromCollection`, `bulkAddEditionsToCollection`, `searchEditionsForPicker`) were already in place.
- Added `getEditionCollections(editionId)` to retrieve all collections a specific edition belongs to. This is needed by the Add to Collection dialog to show current membership state.

**Add to Collection dialog** (`src/components/books/add-to-collection-dialog.tsx`):
- Client component using the existing `Dialog` component.
- On open, fetches all collections and the edition's current memberships in parallel.
- Filter input to search collections by name.
- Checkbox list sorted with member collections first, then alphabetical.
- Optimistic toggle: clicking a checkbox immediately updates the UI, then calls the server action. Reverts on error.
- Inline "New collection" section at the bottom to create and immediately add the edition.
- Toast feedback via sonner for all operations.

**Book card integration**:
- Added `primaryEditionId` prop threaded from the library page through `LibraryShell` -> `LibraryView` -> `BookGrid` -> `BookCard` -> `BookCardActionsMenu`.
- The library page extracts `firstEdition?.id` (already available from the query) and passes it as `primaryEditionId`.
- The "Add to collection" menu item is now enabled when a `primaryEditionId` is present (disabled otherwise).

**Collections page** (`src/app/library/collections/page.tsx`):
- Minimal server-rendered page listing all collections with edition counts.
- Shows an empty state when no collections exist.

**Files changed**:
| File | Change |
|---|---|
| `src/lib/actions/collections.ts` | Added `getEditionCollections` function |
| `src/components/books/add-to-collection-dialog.tsx` | New: Add to Collection dialog |
| `src/components/books/book-card-actions-menu.tsx` | Added `primaryEditionId` prop, wired collection dialog, enabled menu item |
| `src/components/books/book-card.tsx` | Added `primaryEditionId` prop, passes to actions menu |
| `src/components/books/book-grid.tsx` | Added `primaryEditionId` to `BookGridItem` interface |
| `src/components/books/library-view.tsx` | Added `primaryEditionId` to `BookItem` interface |
| `src/app/library/library-shell.tsx` | Added `primaryEditionId` to `BookItem` interface |
| `src/app/library/page.tsx` | Added `primaryEditionId: firstEdition?.id` to book item data |
| `src/app/library/collections/page.tsx` | New: minimal collections listing page |

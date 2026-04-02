# Task 0080: Activity Timeline for Works and Authors

**Status**: Completed
**Created**: 2026-04-01
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: 0081

## Overview

Add a Linear-style activity timeline to both Work detail pages and Author detail pages. Every mutation that permanently affects the entity is automatically recorded and displayed as a clean, chronological vertical timeline. This provides a complete audit trail of all changes made to any Work or Author over time.

The activity section appears as a distinct panel/tab on the detail page, showing events from most recent to oldest with contextual icons, human-readable descriptions, and relative timestamps.

---

## Activity Events to Track

### Work Events

| Event Key | Trigger | Display Text Example |
| --- | --- | --- |
| `work.created` | Work created via wizard or manual entry | "Created this work" |
| `work.title_changed` | Title field updated | "Changed title from *The Aleph* to *El Aleph*" |
| `work.year_changed` | Original year updated | "Changed original year from 1949 to 1945" |
| `work.language_changed` | Original language updated | "Changed original language to Spanish" |
| `work.catalogue_status_changed` | Catalogue status updated | "Changed catalogue status from *wishlist* to *catalogued*" |
| `work.rating_changed` | Rating updated | "Changed rating from 4 to 5" |
| `work.series_changed` | Series assignment changed | "Added to series *Collected Fictions*" / "Removed from series" |
| `work.author_added` | Author linked via `work_authors` | "Added author Jorge Luis Borges" |
| `work.author_removed` | Author unlinked from `work_authors` | "Removed author Jorge Luis Borges" |
| `work.poster_uploaded` | Poster image uploaded | "Uploaded poster image" |
| `work.poster_deleted` | Poster image deleted | "Deleted poster image" |
| `work.poster_default_changed` | Default poster changed (when multiple exist) | "Changed default poster" |
| `work.background_uploaded` | Background image uploaded | "Uploaded background image" |
| `work.background_deleted` | Background image deleted | "Deleted background image" |
| `work.background_default_changed` | Default background changed | "Changed default background" |
| `work.gallery_image_added` | Gallery image added | "Added gallery image" |
| `work.gallery_image_removed` | Gallery image removed | "Removed gallery image" |
| `work.rematched` | Open Library rematch triggered | "Rematched with Open Library" |
| `work.taxonomy_added` | Taxonomy item linked (theme, keyword, movement, etc.) | "Added theme *Existentialism*" |
| `work.taxonomy_removed` | Taxonomy item unlinked | "Removed keyword *Labyrinths*" |
| `work.edition_added` | New edition created | "Added edition (ISBN: 978-0-14-028680-0)" |
| `work.edition_updated` | Edition fields modified | "Updated edition (ISBN: 978-0-14-028680-0)" |
| `work.edition_deleted` | Edition deleted | "Deleted edition" |
| `work.instance_added` | New instance created | "Added instance at *Sanctum Black*" |
| `work.instance_updated` | Instance fields modified | "Updated instance (condition, notes, etc.)" |
| `work.instance_deleted` | Instance deleted | "Deleted instance" |
| `work.collection_added` | Work added to collection | "Added to collection *Gothic Classics*" |
| `work.collection_removed` | Work removed from collection | "Removed from collection *Gothic Classics*" |
| `work.comment_added` | Comment posted (see Task 0081) | "Left a comment" |

### Author Events

| Event Key | Trigger | Display Text Example |
| --- | --- | --- |
| `author.created` | Author created | "Created this author" |
| `author.name_changed` | Name fields updated | "Changed name from *J.L. Borges* to *Jorge Luis Borges*" |
| `author.birth_year_changed` | Birth year updated | "Changed birth year to 1899" |
| `author.death_year_changed` | Death year updated | "Changed death year to 1986" |
| `author.gender_changed` | Gender updated | "Changed gender to *Male*" |
| `author.nationality_changed` | Nationality/country updated | "Changed nationality to *Argentina*" |
| `author.biography_changed` | Biography text updated | "Updated biography" |
| `author.birthplace_changed` | Birthplace updated | "Changed birthplace to *Buenos Aires, Argentina*" |
| `author.poster_uploaded` | Author portrait uploaded | "Uploaded portrait" |
| `author.poster_deleted` | Author portrait deleted | "Deleted portrait" |
| `author.poster_default_changed` | Default portrait changed | "Changed default portrait" |
| `author.background_uploaded` | Background image uploaded | "Uploaded background image" |
| `author.background_deleted` | Background image deleted | "Deleted background image" |
| `author.background_default_changed` | Default background changed | "Changed default background" |
| `author.comment_added` | Comment posted (see Task 0081) | "Left a comment" |

---

## Database Schema Changes

### New Table: `activity_events`

Stores all recorded activity events for both Works and Authors.

```typescript
// src/lib/db/schema/activity-events.ts
export const activityEvents = pgTable("activity_events", {
  id: uuid("id").defaultRandom().primaryKey(),

  // Polymorphic target: either a work or an author
  entityType: text("entity_type").notNull(),       // "work" | "author"
  entityId: uuid("entity_id").notNull(),            // FK to works.id or authors.id

  // Event classification
  eventKey: text("event_key").notNull(),             // e.g. "work.title_changed", "author.poster_uploaded"

  // Human-readable change details (structured JSON for rendering flexibility)
  metadata: jsonb("metadata").$type<{
    oldValue?: string | number | null;               // Previous value (for change events)
    newValue?: string | number | null;               // New value (for change events)
    targetName?: string;                             // Name of related entity (author name, taxonomy label, etc.)
    targetId?: string;                               // ID of related entity
    taxonomyType?: string;                           // "theme" | "keyword" | "movement" | etc. (for taxonomy events)
    editionIsbn?: string;                            // ISBN for edition events
    locationName?: string;                           // Location name for instance events
    collectionName?: string;                         // Collection name for collection events
    extra?: Record<string, unknown>;                 // Catch-all for event-specific data
  }>(),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  entityIdx: index("activity_events_entity_idx").on(table.entityType, table.entityId),
  createdAtIdx: index("activity_events_created_at_idx").on(table.createdAt),
}));
```

### Indexes

- **Composite index** on `(entity_type, entity_id)` for efficient queries: "give me all events for work X".
- **Index** on `created_at` for chronological ordering and potential future pagination.

### Update `docs/02_DATA_MODEL.md`

Add the `activity_events` table to the data model documentation.

---

## File Structure

### New Files

```
src/
  lib/
    db/schema/
      activity-events.ts                  -- Drizzle schema for activity_events table
    activity/
      record.ts                           -- Core function: recordActivity(entityType, entityId, eventKey, metadata)
      queries.ts                          -- Query functions: getActivityForEntity, paginated
      event-config.ts                     -- Event key -> icon + color + display template mapping
  components/
    activity/
      activity-timeline.tsx               -- Main timeline component (vertical chronological list)
      activity-event-item.tsx             -- Single event row: icon + description + timestamp
      activity-event-icon.tsx             -- Icon resolver: maps event keys to Lucide icons + colors
```

### Modified Files

```
src/lib/db/schema/index.ts               -- Export activityEvents
src/app/library/[slug]/page.tsx           -- Add Activity section/tab to work detail
src/app/authors/[slug]/page.tsx           -- Add Activity section/tab to author detail

-- Every mutation endpoint/server action that modifies a work or author must call recordActivity():
src/app/library/[slug]/work-edit-dialog.tsx
src/app/library/[slug]/work-taxonomy-edit-dialog.tsx
src/app/library/[slug]/edition-add-dialog.tsx
src/app/library/[slug]/edition-edit-dialog.tsx
src/app/library/[slug]/instance-add-dialog.tsx
src/app/library/[slug]/instance-edit-dialog.tsx
src/app/library/[slug]/delete-confirm-dialog.tsx
src/app/authors/[slug]/author-edit-dialog.tsx
src/app/authors/author-create-dialog.tsx
src/components/books/match-again-dialog.tsx
src/components/books/work-quick-edit-dialog.tsx
src/components/books/book-card-actions-menu.tsx
src/components/authors/author-card-actions-menu.tsx
src/app/api/media/upload/route.ts
-- (and any other server action that mutates work/author state)
```

---

## UI Design

### Timeline Layout

The activity timeline appears as a section within the Work or Author detail page, below the main content area. It uses a vertical layout with a thin left-side line connecting events chronologically.

```
Activity
------------------------------------------------------------------------
|  [icon]  Changed title from "The Aleph" to "El Aleph"     2d ago    |
|     |                                                                |
|  [icon]  Added theme "Existentialism"                      3d ago    |
|     |                                                                |
|  [icon]  Uploaded poster image                             1w ago    |
|     |                                                                |
|  [icon]  Added edition (ISBN: 978-0-14-028680-0)           1w ago    |
|     |                                                                |
|  [icon]  Created this work                                 2mo ago   |
------------------------------------------------------------------------
```

### Icon Mapping (Lucide Icons)

Each event category maps to a specific icon and muted accent color:

| Category | Icon | Color (muted) |
| --- | --- | --- |
| Created | `Plus` | `--color-muted` (default muted text) |
| Title/name changed | `Pencil` | `--color-muted` |
| Field changed (year, language, etc.) | `Settings2` | `--color-muted` |
| Rating changed | `Star` | `#b8a04a` (muted gold) |
| Catalogue status changed | `BookMarked` | `--color-muted` |
| Author added/removed | `UserPlus` / `UserMinus` | `--color-muted` |
| Poster/image uploaded | `ImagePlus` | `--color-muted` |
| Poster/image deleted | `ImageMinus` | `#8b5c5c` (muted red) |
| Poster/image default changed | `Image` | `--color-muted` |
| Gallery image added/removed | `Images` | `--color-muted` |
| Rematched | `RefreshCw` | `--color-muted` |
| Taxonomy added | `TagPlus` (custom or `Tag`) | `--color-muted` |
| Taxonomy removed | `TagMinus` (custom or `Tag`) | `#8b5c5c` (muted red) |
| Edition added/updated/deleted | `BookOpen` | `--color-muted` |
| Instance added/updated/deleted | `Package` | `--color-muted` |
| Collection added/removed | `FolderPlus` / `FolderMinus` | `--color-muted` |
| Comment added | `MessageSquare` | `--color-muted` |
| Series changed | `List` | `--color-muted` |
| Biography updated | `FileText` | `--color-muted` |
| Gender/nationality changed | `Globe` | `--color-muted` |
| Birthplace changed | `MapPin` | `--color-muted` |
| Deleted items | varies | `#8b5c5c` (muted red) |

### Timestamp Display

- Under 1 minute: "just now"
- Under 1 hour: "5m ago"
- Under 24 hours: "3h ago"
- Under 7 days: "2d ago"
- Under 30 days: "2w ago"
- Under 1 year: "3mo ago"
- Over 1 year: "1y ago"

Full date shown on hover (tooltip): "March 28, 2026 at 14:32"

### Pagination / Lazy Loading

- Initial load: 20 most recent events.
- "Show more" button at the bottom loads next 20.
- No infinite scroll (explicit user action to load more, keeping the page lightweight).

---

## Implementation Approach

### Recording Activity

A single utility function `recordActivity()` is called from every server action or API route that mutates a Work or Author. This function:

1. Accepts `entityType`, `entityId`, `eventKey`, and optional `metadata`.
2. Inserts a row into `activity_events`.
3. Runs as a fire-and-forget insert (does not block the main mutation response). If the insert fails, the mutation still succeeds -- activity recording is best-effort, not transactional with the main operation.

```typescript
// src/lib/activity/record.ts
export async function recordActivity(
  entityType: "work" | "author",
  entityId: string,
  eventKey: string,
  metadata?: ActivityMetadata
): Promise<void> {
  await db.insert(activityEvents).values({
    entityType,
    entityId,
    eventKey,
    metadata: metadata ?? null,
  });
}
```

### Diff Detection for Field Changes

For edit dialogs that update multiple fields at once, the server action should compare old values vs new values and record one activity event per changed field. This means the server action must fetch the current state before applying the update, then diff.

Example: if a user edits a work and changes both the title and the year, two activity events are recorded: `work.title_changed` and `work.year_changed`.

### Querying Activity

```typescript
// src/lib/activity/queries.ts
export async function getActivityForEntity(
  entityType: "work" | "author",
  entityId: string,
  limit: number = 20,
  offset: number = 0
) {
  return db
    .select()
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.entityType, entityType),
        eq(activityEvents.entityId, entityId)
      )
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit)
    .offset(offset);
}
```

---

## Completion Notes

Implemented as planned. All server actions instrumented with fire-and-forget `recordActivity()` calls.

### New files
- `src/lib/db/schema/activity-events.ts` -- Drizzle schema with composite + createdAt indexes
- `src/lib/activity/record.ts` -- Fire-and-forget `recordActivity()` utility
- `src/lib/activity/event-config.ts` -- Event key to icon/color/description mapping (all work + author events)
- `src/lib/activity/types.ts` -- Re-exports ActivityMetadata
- `src/lib/actions/activity.ts` -- `getActivityTimeline()` server action with cursor-based pagination and LEFT JOIN on comments
- `src/lib/utils/relative-time.ts` -- Relative time formatter ("2d ago", "3mo ago") and full date formatter
- `src/components/activity/activity-timeline.tsx` -- Main timeline client component with load-more pagination
- `src/components/activity/activity-event-item.tsx` -- Single event row (icon + description + timestamp)
- `src/components/activity/activity-event-icon.tsx` -- Maps event keys to Lucide icons via EVENT_CONFIG

### Instrumented server actions
- `works.ts` -- createWork, updateWork (with field-level diffing), deleteWork
- `authors.ts` -- createAuthor, updateAuthor (with field-level diffing), deleteAuthor
- `editions.ts` -- createEdition, updateEdition, deleteEdition, rematchEdition
- `instances.ts` -- createInstance, updateInstance, deleteInstance
- `taxonomy.ts` -- updateWorkTaxonomy
- `media.ts` -- createMedia, deleteMedia, setActiveMedia
- `collections.ts` -- addEditionToCollection, bulkAddEditionsToCollection

### Integration
- Work detail page: timeline inserted between Orders and Notes sections
- Author detail page: timeline inserted between Edition Contributions and Gallery sections
- Migration `0018_pale_klaw.sql` applied to Neon

# Server Actions

All database operations in Durtal are performed through server actions (`"use server"` functions). These are the business logic layer — they validate input, execute queries, manage relationships, and handle S3 operations.

Server actions are called directly by server components and client components without an HTTP round-trip for server-rendered pages.

---

## Works (`src/lib/actions/works.ts`)

### `getWorks(opts?)`

List works with pagination, search, and sorting.

```typescript
getWorks(opts?: {
  search?: string;
  sort?: "recent" | "title" | "year" | "rating";
  limit?: number;   // default 50
  offset?: number;  // default 0
}): Promise<WorkWithRelations[]>
```

Returns works with loaded relations: `editions` (with cover keys), `workAuthors` (with author data), `workSubjects`, `media`.

Search matches against work title using `ilike`. Sort options:
- `recent`: `createdAt` descending
- `title`: alphabetical ascending
- `year`: `originalYear` descending (nulls last)
- `rating`: `rating` descending (nulls last)

### `getWorkCount(search?)`

```typescript
getWorkCount(search?: string): Promise<number>
```

Returns total count of works matching the search. Used for pagination.

### `getWork(id)`

```typescript
getWork(id: string): Promise<WorkWithRelations | null>
```

Fetches a single work with all relations deeply loaded:
- `editions` → `instances` → `location`, `subLocation`
- `editions` → `contributors` → `author`
- `editions` → `editionGenres` → `genre`
- `editions` → `editionTags` → `tag`
- `workAuthors` → `author`
- `workSubjects` → `subject`
- `media`

### `createWork(input)`

```typescript
createWork(input: CreateWorkInput): Promise<Work>
```

Validated against `createWorkSchema` (Zod). Gives the book its id and slug first (`{title}-by-{author}`, numbered when taken), then writes the work, its `work_authors` (minimum 1 author, through `bookAuthorQueries`), `work_subjects` and recommendations (through the shared `curationQueries`) in one transaction (`atomic`): a failure leaves no half-created book. Returns the stored work.

### `updateWork(id, input)`

```typescript
updateWork(id: string, input: Partial<CreateWorkInput>): Promise<Work>
```

Updates work metadata in one transaction: the work row, its personal curation (`rating`, `notes`, `recommenderIds` through the shared `curationQueries`, which every domain uses), `authorIds` (through `bookAuthorQueries`, which keeps credit ids) and `subjectIds`. A failure in any part changes nothing. A repeated recommender is stored once. Returns `{ id }`, plus `slug` when a new title or primary author changed the book's address; the book page goes to that address.

### `deleteWork(id)`

```typescript
deleteWork(id: string): Promise<{ id: string; cleanupPending: boolean }>
```

Deletes the work, its comments, activity events and gallery layout in one write. Cascades to editions, instances, junction rows, and media. Then deletes the work's S3 files: images, edition covers and comment attachments (see `docs/07_STORAGE.md`, Deleting Files). `cleanupPending` is `true` when some files could not be deleted.

### `findDuplicateWork(opts)`

```typescript
findDuplicateWork(opts: {
  isbn13?: string;
  title: string;
  authorName: string;
}): Promise<WorkWithRelations | null>
```

Used by the add-book wizard to prevent duplicate work creation. Checks in two passes:

1. **ISBN match**: Exact match against `editions.isbn13`. If found, returns the parent work.
2. **Title + author match**: Case-insensitive title match via `ilike`, then checks if any candidate has an author whose name partially matches `authorName`.

Returns the first matching work with editions and instance counts, or `null` if no duplicate found.

### `getLibraryStats()`

```typescript
getLibraryStats(): Promise<{
  works: number;
  editions: number;
  instances: number;
  authors: number;
  recentWorks: WorkWithRelations[];
}>
```

Dashboard statistics. Returns counts for all major entities and the 8 most recently added works with full relations.

---

## Editions (`src/lib/actions/editions.ts`)

### `getEdition(id)`

```typescript
getEdition(id: string): Promise<EditionWithRelations | null>
```

Fetches edition with: `work`, `instances` (with locations), `contributors` (with authors), `editionGenres`, `editionTags`.

### `createEdition(input)`

```typescript
createEdition(input: CreateEditionInput): Promise<Edition>
```

Refuses an ISBN-13 that another edition has. A contributor is `{ authorId, role }` or, for a person not yet in the library, `{ authorName, role }`; the name is matched to an existing author first. Then uploads the cover from `coverSourceUrl` under the new edition's id and writes the edition, its publishers, contributors (and any new authors), genres, tags and activity in one transaction. A failure writes nothing and deletes the uploaded cover. Returns the edition plus `coverUnavailable` when the cover could not be downloaded (its source URL is still saved).

### `updateEdition(id, input)`

```typescript
updateEdition(id: string, input: Partial<CreateEditionInput>): Promise<Edition>
```

Updates edition metadata. If a new `coverSourceUrl` is provided and differs from the existing one, reprocesses the cover. The edition row, its publishers, contributors (and any new authors named by `authorName`), genres and tags change in one transaction.

---

## Add-book wizard (`src/lib/actions/wizard.ts`)

### `isIsbnInUse(isbn13)`

```typescript
isIsbnInUse(isbn13: string): Promise<{ inUse: false } | { inUse: true; title: string | null }>
```

The edition step calls this before it moves on, so a duplicate ISBN shows on that step.

### `createBookFromWizard(input)`

```typescript
createBookFromWizard(input: WizardBookInput): Promise<
  | { ok: true; workId: string; slug: string | null; editionId: string; coverUnavailable: boolean }
  | { ok: false; error: string }
>
```

Adds a book in one write. Validated against `wizardBookSchema`: the primary author's name, a new work (or `existingWorkId`), its taxonomy, the edition, up to 50 copies and the collections to join. Reads and checks come first: a duplicate ISBN, the locations and collections, and that the existing work is a book. Then the author is found by name or planned, the work and edition get their ids and slugs, and the cover is uploaded. The author, work, taxonomy, edition, copies, collection links and all their activity go out as one transaction. A failure writes nothing and deletes the cover. Errors come back as `{ ok: false, error }`, because a production build hides a thrown error's message.

## Match (`src/lib/actions/match.ts`)

Match with a preview (task 0184). Nothing is saved until the reader ticks it.

### `previewMatch(editionId, source, sourceId)`

```typescript
previewMatch(editionId: string, source: MatchSource, sourceId: string): Promise<MatchPreview>
```

Reads the record from ISBNdb, Google Books or Open Library and compares it with the edition, field by field (`planMatch` in `src/lib/match/plan.ts`). Writes nothing. Guardrails: an empty source value never clears a field; with the same ISBN only empty fields are ticked; with a new ISBN every change is ticked and the old imprint and country are offered for clearing; a distributor or placeholder publisher name is never ticked; an ISBN another edition holds is blocked and nothing is ticked. Source values that cannot be right (bad ISBN check digit, year 0, unknown language or binding, hidden control characters) are dropped by `cleanRecord` in `src/lib/match/source.ts`. Returns the rows, warnings, and the house the edition links to with the ticked values.

### `previewMatchHouses(editionId, values)`

```typescript
previewMatchHouses(editionId: string, values: { publisher, imprint, isbn13, isbn10 }): Promise<MatchHouses>
```

The houses `edition_publisher_matches` gives for these values, the current links, and whether the links were set by hand. Used when the reader ticks or unticks a field.

### `applyMatch(editionId, source, sourceId, accepted, relink?)`

```typescript
applyMatch(editionId: string, source: MatchSource, sourceId: string, accepted: { field: MatchField; value: MatchValue }[], relink?: boolean): Promise<{ changed: number }>
```

Reads the source again and saves only the accepted fields. A value that is not the one the preview showed, or a blocked value, stops the save. A locked edition is refused. `relink` lets links set by hand follow the new data. Records `work.rematched` with the fields and their old and new values.

## Identify (`src/lib/actions/identify.ts`)

Placeholder editions of the old import (task 0187). Ranking rules live in `src/lib/match/identify.ts`; saving goes through `saveMatch` in `src/lib/match/save.ts`, the same guarded save as Match.

### `getIdentifyQueue()`

Every edition with metadata source `phantom_canon`, with its book, poster, copies, collections, house links and the book's identified editions. Books with copies first, then by catalogue status.

### `findEditionCandidates(editionId, query?)`

Searches ISBNdb (up to 50 results for "title first-author", or one lookup when `query` is an ISBN) and ranks the results. Dropped: no valid ISBN; neither title nor author match (kept with notes when the reader typed the ISBN); an ISBN another edition holds. Ranked by title, author, language, format (e-books first only when every copy is digital), the house the placeholder already links to, cover, publisher and page count. Writes nothing.

### `identifyEdition(editionId, isbn13)`

Placeholders only. Reads the ISBNdb record again and saves every field Match would tick (`planMatch`): a distributor name is left out, an ISBN another edition holds stops the save, and a cover that cannot be downloaded is left out. Copies and collections stay on the edition. Returns the old and new values for undo.

### `keepWithoutIsbn(editionId)`

Placeholders only. Sets the metadata source to `manual`: the edition leaves the queue and loses its badge.

### `undoIdentification(editionId, undo)`

Restores the old values of an identification (or a "keep without ISBN") and makes the edition a placeholder again. Refused when the edition changed after it.

### `moveToExistingEdition(placeholderId, editionId)`

Moves a placeholder's copies and collection memberships to an identified edition of the same book and deletes the placeholder, in one transaction. Refused when anything else refers to the placeholder (orders, hunting targets, contributors, genres, tags, taxonomy items, identifiers, source records) or when it has a cover.

### `deleteEdition(id)`

```typescript
deleteEdition(id: string): Promise<{ id: string; cleanupPending: boolean }>
```

Deletes the edition. Cascades to instances and junction rows. Then deletes its cover files and records `work.edition_deleted` on the work.

---

## Instances (`src/lib/actions/instances.ts`)

### `createInstance(input)`

```typescript
createInstance(input: CreateInstanceInput): Promise<Instance>
```

Creates an instance record linking an edition to a location. Validates against `createInstanceSchema`.

### `updateInstance(id, input)`

```typescript
updateInstance(id: string, input: Partial<CreateInstanceInput>): Promise<Instance>
```

Updates instance metadata: condition, location, loan status, acquisition details, collector flags.

### `deleteInstance(id)`

```typescript
deleteInstance(id: string): Promise<void>
```

---

## Authors (`src/lib/actions/authors.ts`)

### `getAuthors(opts?)`

```typescript
getAuthors(opts?: {
  search?: string;
  limit?: number;   // default 100
  offset?: number;  // default 0
}): Promise<Author[]>
```

Lists authors ordered by `sortName`. Search matches against `name` using `ilike`.

### `getAuthorCount(search?)`

```typescript
getAuthorCount(search?: string): Promise<number>
```

### `getAuthor(id)`

```typescript
getAuthor(id: string): Promise<AuthorWithRelations | null>
```

Returns author with: `workAuthors` (with work data), `editionContributors` (with edition data), `media`.

### `createAuthor(input)`

```typescript
createAuthor(input: CreateAuthorInput): Promise<Author>
```

Creates author record. Auto-generates `sortName` from `name` if not provided (inverts "First Last" to "Last, First"). The unique slug is decided first and written with the row; `updateAuthor` writes a renamed author's new slug in the same update.

### `findOrCreateAuthor(name)`

```typescript
findOrCreateAuthor(name: string): Promise<Author>
```

Finds an existing author by name (case-insensitive `ilike` match) or creates a new one. The work edit dialogs use it when the user adds a new author. The wizard, fast track and the edition dialogs do not: they send the name and the new author is written with the book.

### `updateAuthor(id, input)`

```typescript
updateAuthor(id: string, input: Partial<CreateAuthorInput>): Promise<Author>
```

### `deleteAuthor(id)`

```typescript
deleteAuthor(id: string): Promise<{ id: string; cleanupPending: boolean }>
```

Deletes the author, its comments, activity events and gallery layout in one write. Cascades to `work_authors`, `edition_contributors` and media. Then deletes the author's S3 files: images, photo and comment attachments.

### `mergeAuthors(sourceId, targetId)`

```typescript
mergeAuthors(sourceId: string, targetId: string): Promise<{ targetId: string; sourceName: string; targetName: string }>
```

In one write: copies the source's `work_authors`, `edition_contributors` and `author_contribution_types` rows to the target (rows the target already has are skipped), moves the source's comments and their `comment_added` events to the target, deletes the source's other events and gallery layout, deletes the source author, and records `author.merged` on the target. Then deletes the source's images and photo from S3.

---

## Locations (`src/lib/actions/locations.ts`)

### `getLocations()`

```typescript
getLocations(): Promise<(Location & {
  subLocations: SubLocation[];
  _count: { instances: number };
})[]>
```

Returns all locations with sub-locations and instance counts. Ordered by `sortOrder`.

### `getLocation(id)`

```typescript
getLocation(id: string): Promise<LocationWithSubLocations | null>
```

### `createLocation(input)`

```typescript
createLocation(input: CreateLocationInput): Promise<Location>
```

Validates against `createLocationSchema`. Supports both physical (with address, coordinates) and digital locations.

### `updateLocation(id, input)` / `deleteLocation(id)`

Standard CRUD. Delete cascades to instances at that location.

### `createSubLocation(input)` / `updateSubLocation(id, input)` / `deleteSubLocation(id)`

CRUD for sub-locations within a parent location.

---

## Collections (`src/lib/actions/collections.ts`)

### `getCollections()`

```typescript
getCollections(): Promise<(Collection & { _count: { editions: number } })[]>
```

### `getCollection(id)`

```typescript
getCollection(id: string): Promise<CollectionWithEditions | null>
```

Returns collection with all editions fully loaded (including work data and instance counts).

### `createCollection(input)` / `updateCollection(id, input)` / `deleteCollection(id)`

Standard CRUD for collections.

### `addEditionToCollection(collectionId, editionId, sortOrder?)`

```typescript
addEditionToCollection(
  collectionId: string,
  editionId: string,
  sortOrder?: number
): Promise<void>
```

Uses `onConflictDoNothing` to prevent duplicates.

### `removeEditionFromCollection(collectionId, editionId)`

```typescript
removeEditionFromCollection(
  collectionId: string,
  editionId: string
): Promise<void>
```

---

## Orders (`src/lib/actions/orders.ts`)

### `createOrder(input)`

```typescript
createOrder(input: CreateOrderInput): Promise<Order>
```

Writes the order and its first `order_status_history` row in one transaction, then syncs the book's catalogue status from all its orders.

### `createOrderForNewBook(input)`

```typescript
createOrderForNewBook(input: {
  book: { title: string; authorName: string };
  order: Omit<CreateOrderInput, "workId">;
}): Promise<{ order: Order; slug: string | null }>
```

Orders a book the library does not have yet. The author (found by name or created), the book (`catalogue_status = 'on_order'`), the order and its first history row are one transaction. The order dialog keeps a typed book as a draft and calls this on submit, so a cancelled dialog writes nothing.

### `updateOrderStatus(id, status, notes?)` / `deleteOrder(id)`

Each status change writes the order and its history row in one transaction. It is refused with "The order changed; reload before changing its status" when another change moved the order first. A delete removes the order with its history rows (they cascade); the book's own status history records the change.

---

## Taxonomy (`src/lib/actions/taxonomy.ts`)

### Subjects

```typescript
getSubjects(): Promise<Subject[]>
createSubject(input: { name: string; slug: string }): Promise<Subject>
deleteSubject(id: string): Promise<void>
```

### Genres

```typescript
getGenres(): Promise<Genre[]>
createGenre(input: { name: string; slug: string; parentId?: string; sortOrder?: number }): Promise<Genre>
updateGenre(id: string, input: Partial<...>): Promise<Genre>
deleteGenre(id: string): Promise<void>
```

Genres support hierarchy via `parentId`. Deleting a parent sets children's `parentId` to null (SET NULL).

### Tags

```typescript
getTags(): Promise<Tag[]>
createTag(input: { name: string; color?: string }): Promise<Tag>
updateTag(id: string, input: Partial<...>): Promise<Tag>
deleteTag(id: string): Promise<void>
```

---

## Media (`src/lib/actions/media.ts`)

### `getMediaForWork(workId)` / `getMediaForAuthor(authorId)`

```typescript
getMediaForWork(workId: string): Promise<Media[]>
getMediaForAuthor(authorId: string): Promise<Media[]>
```

Returns all media ordered by `sortOrder`.

### `getPoster(entityType, entityId)` / `getBackground(entityType, entityId)`

```typescript
getPoster(entityType: "work" | "author", entityId: string): Promise<Media | null>
getBackground(entityType: "work" | "author", entityId: string): Promise<Media | null>
```

Returns the first media record of the specified type.

### `createMedia(input)`

```typescript
createMedia(input: CreateMediaInput): Promise<Media>
```

Validates that exactly one of `workId` or `authorId` is set (XOR). Validated against `createMediaSchema`.

### `updateMedia(id, input)`

Updates `sortOrder` and `caption`.

### `deleteMedia(id)` / `bulkDeleteMedia(ids)`

Deletes the media records first, then their S3 objects (full image, thumbnail and original). A file that another row still stores is kept. `deleteMedia` makes the next image of the same type active when it deletes the active one.

### `reorderMedia(ids)`

```typescript
reorderMedia(ids: string[]): Promise<void>
```

Batch update: sets `sortOrder` to the array index position for each media ID.

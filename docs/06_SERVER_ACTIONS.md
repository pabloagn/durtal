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

Validated against `createWorkSchema` (Zod). Creates the work record, then inserts `work_authors` junction rows (minimum 1 author required) and `work_subjects` junction rows.

### `updateWork(id, input)`

```typescript
updateWork(id: string, input: Partial<CreateWorkInput>): Promise<Work>
```

Updates work metadata. If `authorIds` is provided, deletes existing `work_authors` rows and reinserts. Same for `subjectIds` and `work_subjects`.

### `deleteWork(id)`

```typescript
deleteWork(id: string): Promise<void>
```

Deletes the work. Cascades to editions, instances, junction rows, and media.

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

Creates the edition record. If `coverSourceUrl` is provided, calls `processAndUploadCover()` to download, resize, and upload the cover image to S3. Links contributors, genres, and tags via junction tables.

### `updateEdition(id, input)`

```typescript
updateEdition(id: string, input: Partial<CreateEditionInput>): Promise<Edition>
```

Updates edition metadata. If a new `coverSourceUrl` is provided and differs from the existing one, reprocesses the cover. Updates contributor, genre, and tag relationships.

### `deleteEdition(id)`

```typescript
deleteEdition(id: string): Promise<void>
```

Deletes the edition. Cascades to instances and junction rows.

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

Creates author record. Auto-generates `sortName` from `name` if not provided (inverts "First Last" to "Last, First").

### `updateAuthor(id, input)`

```typescript
updateAuthor(id: string, input: Partial<CreateAuthorInput>): Promise<Author>
```

### `deleteAuthor(id)`

```typescript
deleteAuthor(id: string): Promise<void>
```

Cascades to `work_authors` and `edition_contributors` junction rows.

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

### `deleteMedia(id)`

Deletes the media record and both S3 objects (full image and thumbnail).

### `reorderMedia(ids)`

```typescript
reorderMedia(ids: string[]): Promise<void>
```

Batch update: sets `sortOrder` to the array index position for each media ID.

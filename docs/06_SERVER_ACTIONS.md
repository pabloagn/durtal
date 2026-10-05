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
  sort?: "recent" | "title" | "year" | "rating" | "authorFirstName" | "authorLastName" | "lastRead";
  order?: "asc" | "desc";
  limit?: number;   // default 50
  offset?: number;  // default 0
  filters?: WorkFilters;
}): Promise<WorkWithRelations[]>
```

`WorkFilters` (SLN-449) is `ReadingFilterParams` (`reading`, `readFrom`, `readTo`, `reread`, `holding`, `catalogueStatus`, from `parseReadingFilters`) with `marks`, `isRare`, `isPoison`, `publisherIds`, `acquisitionPriority`, `minRating` (the book's rating), `locationId` and `hasPoster`. The reading and holding conditions are `readingFilterConditions` (`src/lib/reading/filter-conditions.ts`), shared with `getWorksForTimeline`, which checks them again with `readingFiltersSchema` since the browser sends them back. Each work carries root extras in the same query: `readingState`, `readingPercent` (a number), `timesRead`, `lastFinishedOn` and `lastFinishedPrecision`; `getLibraryStats`' recent and top-rated books carry them too. `cardReadingOf` turns them into a card's `reading`.

Returns works with loaded relations: `editions` (with cover keys), `workAuthors` (with author data), `workSubjects`, `media`.

Search matches against work title using `ilike`. Sort options:
- `recent`: `createdAt` descending
- `title`: alphabetical ascending
- `year`: `originalYear` descending (nulls last)
- `rating`: `rating` descending, or ascending with `order: "asc"`; unrated works last either way
- `lastRead`: `lastReadAtSql` (the later of the last progress and the last finish) descending, never-read works last

### `getWorkCount(search?, filters?)`

```typescript
getWorkCount(search?: string, filters?: WorkFilters): Promise<number>
```

Returns total count of works matching the search and filters. Used for pagination. `getWorks` and `getWorkCount` build their where clause with the same `buildWorkConditions()`, so a new filter goes there once and the list and the count always agree. `getWork` and `getWorkBySlug` load the same `workDetailWith` relations.

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

Updates work metadata in one transaction: the work row, its personal curation (`rating`, 0.5 to 5 in half steps through `RATING_SCHEMA` in `src/lib/validations/helpers.ts`, as in `createWorkSchema` and `curationPatchSchema`; `notes`, `recommenderIds` through the shared `curationQueries`, which every domain uses), `authorIds` (through `bookAuthorQueries`, which keeps credit ids) and `subjectIds`. A failure in any part changes nothing. A repeated recommender is stored once. Returns `{ id }`, plus `slug` when a new title or primary author changed the book's address; the book page goes to that address.

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

### `createLocation(input)`

```typescript
createLocation(input: CreateLocationInput): Promise<Location>
```

Validates against `createLocationSchema`. Supports both physical (with address, coordinates) and digital locations.

### `updateLocation(id, input)` / `deleteLocation(id)`

Standard CRUD. Delete cascades to instances at that location. When the location is the default location for new copies, the database clears that setting, and `deleteLocation` refreshes the cached settings.

### `createSubLocation(input)` / `updateSubLocation(id, input)` / `deleteSubLocation(id)`

CRUD for sub-locations within a parent location.

---

## Settings (`src/lib/actions/settings.ts`, `src/lib/actions/integrations.ts`)

### `getAppSettings()`

```typescript
getAppSettings(): Promise<AppSettings>
// { newBookStatus, newBookLanguage, newCopyLocationId, newCopyFormat, newCopyCondition, homeCurrency,
//   readingDayStartHour, readingWeekStart, readingTimerCheckMinutes }
```

The one `app_settings` row, cached under the tag `ref:settings`. A stored value the app no longer offers falls back to its default. Before migration 0052 has run (no table, error 42P01), it returns the defaults. The root layout reads it once per request and passes it to `AppSettingsProvider`; client components read it with `useAppSettings()` (`src/lib/hooks/use-app-settings.tsx`).

### `updateAppSettings(input)`

```typescript
updateAppSettings(input: Partial<AppSettingsInput>): Promise<
  { ok: true; settings: AppSettings } | { ok: false; error: string }
>
```

Changes only the fields given, after `appSettingsInputSchema` (`src/lib/validations/settings.ts`): a status other than deaccessioned, a language from `LANGUAGES`, an existing location or null, an `INSTANCE_FORMATS` / `INSTANCE_CONDITIONS` value or null, a supported currency, a reading day start hour from 0 to 6, a week start of 1 (Monday) or 7 (Sunday), and a timer check of 15 to 480 minutes (SLN-451, from `/settings/reading`). Problems come back as `{ ok: false, error }`. Invalidates `ref:settings` and the root layout.

### `refreshCachedData()`

```typescript
refreshCachedData(): Promise<{ ok: true; tags: number }>
```

Invalidates every `CACHE_TAGS` tag and the root layout, so the next page load reads the database again. For changes made outside the app, such as a script.

### `checkIntegration(id)`

```typescript
checkIntegration(id: IntegrationId): Promise<{ status: "ok" | "warning" | "error" | "off"; message: string }>
```

A live check of one outside service (`src/lib/settings/integrations.ts`): database (`select 1`), storage (`HeadBucket`, and the bucket's region against `AWS_REGION`), ISBNdb, Google Books, Open Library (one known ISBN), Google Places (ids only), Nominatim (`/status`), Wikidata. Each has an 8 s limit and no cache. The message never holds a URL, header, body or secret. Mapbox is checked by the browser. Never called from `/api/health`.

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

## Reading (`src/lib/actions/reading.ts`, SLN-444)

Every write parses its input (`src/lib/validations/reading.ts`), checks the book (`requireBookWork`), reads the reading and its fingerprint, then runs one atomic write that locks the reading and asserts the fingerprint; a stale one gives "This reading changed elsewhere; reload before saving". Each returns the reading with its new fingerprint, records its history entry after the write, and invalidates `works` and `reading`. Ratings are 0.5 to 5.0 in half steps. Times and default dates use the browser's `timeZone` when given, else `APP_TIMEZONE`, and the reading day: hours before `app_settings.reading_day_start_hour` (04:00 by default) count for the evening before. Every writer reads the hour with `readingDayStartHour()` (`src/lib/reading/day.ts`); no caller passes a literal hour.

### `startReading(input)`
Starts a book: copy, edition, home, format (from the copy: e-book files are `ebook`, audiobooks `audio`), unit, totals (pages from the edition), start date (today's reading day, or unknown) and at most one start position. Refused while the book has an open reading ("This book is already being read", or "This book has a paused reading; resume it"). `work.reading_started`.

### `logProgress(input)`
A page, percent, minutes, pages or minutes on, or a chapter, in the reading's edition or another of the book's. A paused reading resumes first. A new session starts where the session order says and ends at the new place; going back follows `goingBack` (`fix_last_log` replaces the latest session's end, `went_back` writes a session that counts nothing; without it, a log on the latest session's day fixes it). Past the last page or the end is refused with the page or time. Returns `{ reading, session, reachedEnd, wentBack, undo }`. `work.reading_progress` at most once per reading per day.

### `undoProgress({ readingId, fingerprint, undo })`
Deletes the session a log wrote, or puts back the end it replaced, recomputes the position, and pauses the reading again when the log had resumed it.

### `pauseReading(input)` / `resumeReading(input)`
Status changes with a history row; `work.reading_paused`, `work.reading_resumed`.

### `finishReading(input)`
From reading or paused: the end (100%, last page and minutes), the date (default today, day precision), rating and review; with a rating it also sets the book's rating unless `setBookRating` is false (`work.rating_changed`). When the end is ahead and the reading has sessions, a closing session carries the last pages (on the finish day, or the latest session's day for an imprecise finish). Returns `{ reading, undo }` for the Undo toast.

### `abandonReading(input)`
From reading or paused: when, why (`ABANDON_REASONS`), a note and the page reached, with a closing session as for a finish. `work.reading_abandoned`.

### `reopenReading(input)`
Finished or abandoned back to reading or paused: clears the finish date and reason, restores the position and deletes the closing session when given (the Undo of finish and abandon), and puts the book's rating back only while it still has the value the finish set ("The book's rating was changed since; it was kept"). Refused while another reading of the book is open.

### `addPastReading(input)`
A finished or abandoned read from the past in one step, through `writeReadings` (`source: "manual"`, the book's rating set only if it has none). Returns written, already present ("You already logged this read: finished 14 Apr 2019"), or a possible duplicate, written only with `allowPossibleDuplicate`.

### `updateReading(input)`
Edition or copy (the start and current positions are mapped by share; with no page count, page null and unit percent; `work.reading_edition_changed`), format, unit, home (physical only), totals (never below the position: "You are on p. 212; the book cannot have 200 pages"), dates (the finish only on a finished or abandoned read, after the start), rating, review, reason and note.

### `deleteReading(input)` / `restoreReading(snapshot)`
Deletes a reading with its sessions and history and returns the snapshot; restore puts it back with the same ids, an edition, copy or place deleted meanwhile coming back empty, and is refused if it would make a second open reading. `work.reading_deleted`.

### `updateSession(input)` / `deleteSession(input)`
Edit or remove one session (not the running timer); the next session's start and the open reading's position follow. With no session left, the position returns to the start. `deleteSession` returns `{ reading, session }`: the deleted row, for its Undo.

### `addSession(input)` / `restoreSession({ readingId, fingerprint, snapshot })` (SLN-451)
`addSession({ readingId, fingerprint, readOn, startedAt?, endedAt?, durationSeconds?, to: { page | percent | minutes }, chapter?, editionId?, format?, note?, timeZone })` adds one session by hand: `recordProgress` with `source: "manual"` and `goingBack: "went_back"`, so it never replaces another. It takes its place in the session order: it starts where the session before it ended, the next session's start follows, and the position moves only when it is the newest. Open readings only; `startedAt` and `endedAt` must fall on `readOn` in `timeZone`. Its Undo is `deleteSession`. `restoreSession` is the Undo of a delete: it puts the row back with its id and source and recomputes the next start and the position; refused for a running timer.

### `getReadingSessions(readingId)` (SLN-451)
One reading's sessions for the session list, newest first in the session order, each with its edition's title, and the running timer apart: `{ running, sessions }`. The list calls it when it opens.

### The reading timer (SLN-451)
One timer in the whole app: the session with `source = 'timer'` and `ended_at` null. Writes go through `src/lib/reading/timer-service.ts` and `recordProgress`.
- `getRunningTimer()`: the running session with its book (title, slug, author, cover), its reading's position, unit, totals and fingerprint (equal to `readingFingerprintSql`), `startedAt`, `pausedAt` and `pausedSeconds`, or null. The chip calls it after mount, on focus and when the tab shows again.
- `startTimer({ readingId, timeZone })`: refused while any timer runs ("A timer is running for Nadja. Stop it first"). A paused reading resumes first (`work.reading_resumed`). The session starts at the reading's position, in the sent zone, with `read_on` the reading day it started: a timer keeps that day and zone however late or wherever it stops.
- `pauseTimer({ sessionId })` / `resumeTimer({ sessionId })`: set `paused_at`; add `now - paused_at` to `paused_seconds`. Pausing a paused timer or resuming a running one changes nothing.
- `stopTimer({ sessionId, endedAt?, page?, percent?, minutes?, addPages?, addMinutes?, chapter?, editionId?, format?, goingBack?, note? })`: completes the running row through `recordProgress` with `timerSessionId` (no fingerprint: a fresh read, asserted in the same atomic with the row still running, one retry). It starts where the session before it ends, so a page logged by hand during the timer is never counted twice. It ends at `endedAt`, else now; a paused timer at its pause. `duration_seconds = ended_at - started_at - paused_seconds`, at least 1. No position: 0 pages, its time counted. Refused over 12 hours ("Edit the end time; a session can be at most 12 hours") and, without `endedAt`, past twice `reading_timer_check_minutes` ("Your timer for Nadja has run 6 h 12 min. When did you stop?"). Returns `{ reading, session, reachedEnd, undo }`.
- `undoStopTimer({ sessionId, fingerprint, undo })`: the timer runs again (its end cleared, its pause restored) and the position is recomputed; refused while another timer runs ("A timer is running for La Curée").
- `discardTimer({ sessionId })`: deletes the running row; the position does not change.
- Any of them on a timer stopped or discarded elsewhere: "This timer was stopped on another device".
- While a reading's timer runs, `pauseReading`, `finishReading`, `abandonReading` and `deleteReading` refuse with "Stop or discard the timer for Nadja first". Logging progress is allowed.

### `getPaceContext(readingIds)` (SLN-451)
The estimates' inputs in one query: each reading's format, unit, edition language, totals and position; its ended sessions with `countedPagesSql` pages, duration, format and the book minutes they moved (the running timer left out); its paused intervals from `reading_status_history`; and the priors, his pages an hour over the last two years by language and format, by format and overall. Numbers come back as `float8`. `getPaceContext([])` gives the priors alone (Up Next and suggestions use them). Computed per request, never cached. `readingEstimates(ids, today)` (`src/lib/reading/estimates.ts`) turns it into each reading's line and explanation with the pure `src/lib/reading/pace.ts`.

### `getReadingsForWork(workId)`, `getOpenReadings()`, `getReadingCounts(workId)`
A book's readings newest first (fingerprint, ordinal, sessions and time, edition with translators, copy and shelf, home); every open reading with its book, author, cover and when it was paused, most recently read first (the hub, the dashboard, and the command palette, which calls it each time it opens); the readings and sessions a book delete removes.

### What the book page calls (SLN-447)
The header control, the Reading section and its dialogs call `startReading`, `logProgress` and `undoProgress`, `pauseReading`, `resumeReading`, `finishReading`, `abandonReading`, `reopenReading` (the Undo of finish and abandon, and "Resume this reading" with `toStatus: "reading"`), `addPastReading`, `updateReading`, `deleteReading` and `restoreReading`. Every write sends the browser's `timeZone` and, on an existing reading, the fingerprint from `getReadingsForWork` or the last write. A "212/480" log first sets the page count with `updateReading`.

### `getNextInSeries(workId, homeId)`
After a finish: the series' next volume to read (`nextToRead` in `src/lib/reading/series.ts`: the first volume in series order not finished, after the last finished one) with where its copy is (the copy at hand at the home, else its first copy in the collection, else "Not owned"). Null when the book is in no series or every later volume is read.

### `findPageCount(editionId)`
An edition's page count from ISBNdb (by ISBN-13), then Open Library (by its edition key), or null. It writes nothing: saving it to the edition is the match flow's job.

### `searchBooksToRead(query)` (SLN-448)
The book picker: books only, matched without accents on title and authors (`textSearchCondition`, no typos), owned books first (`ownedBookCondition` in `src/lib/catalogue/holdings.ts`: a copy that is not deaccessioned), then by title without accents, at most 20. Each with its first author, a cover, the catalogue status, the reading state, the finished reads, the open reading's share, and the open reading's id and fingerprint (Start on a book being read logs progress on it). An empty query lists the first 20.

### `getReadingDialogData(workId, homeId)` (SLN-448)
What a reading dialog needs for a book opened away from its page (the hub, the dashboard, the palette, `?then=`): its readings (as `getReadingsForWork`), its editions with their copies ranked by the "I'm at" home, the homes, its rating, today's reading day and the zone. `ReadingDialogsProvider` calls it when a dialog opens and after each write.

### `getReadingSummaries(workIds)` (SLN-449)
The library list's and table's reading for one page of books (at most 192 uuids, the largest page size), in one query: `{ state, timesRead, lastFinishedOn, lastFinishedPrecision, lastReadAt, percent }` by work id. `LibraryView` calls it only while the list or table view shows.

### `getReadYearRange()` (SLN-449)
The years with a finished reading, for the library's "Read in" range.

### `getSeriesNextToRead(seriesId)` (SLN-449)
The series page's "Next to read": `nextToRead`'s volume and where its copy is (an available physical copy, an available digital one, any copy still held, through `copyWhereabouts`), else "Not owned · <status>".

### Hub queries (`src/lib/reading/journal.ts`, not server actions)
- `queryJournal(query)`: one page of readings for `/reading/journal` with the filtered summary (readings, finished, abandoned, re-reads). Each row has the read's rating (`readingRatingSql`), whether it is a re-read (`rereadSql` in `src/lib/reading/summary.ts`), its book, author, cover, edition language and fingerprint.
- `getJournalFacets()`: the years of finish and the formats, for the filters.
- `getRecentlyFinished(limit)`: the latest finished reads with the read's rating, unknown dates last.

### Internal service (`src/lib/reading/service.ts`, not a server action)
- `createReading(input, { source, sourceKey?, importId? })`: the start every writer shares; with a known source key it returns that reading unchanged.
- `recordProgress(input, { fingerprint?, source, editionId?, format? })`: the progress write. Without a fingerprint (REST, the timer, the reader) it builds the write from a fresh read, asserts it, and retries once ("This reading changed elsewhere; try again"). With `timerSessionId` (SLN-451) it completes that running timer row instead of inserting a session, keeping its zone and day, and asserts in the same atomic that the row still runs.
- `writeReadings(rows, { source, importId? })`: the batch writer for imports, the seed, the backfill and past reads. Each row is validated, checked with the duplicate rule (the count rule for imports), refused when it would open a second reading, and written with its history row, at most 100 per atomic; a repeated run writes nothing again. The book's rating is set `if_none` or `replace`, with `{ before, after }` in the outcome. `allowPossibleDuplicate` writes a possible duplicate, and an undated read the import's count rule called present ("Import anyway").

---

## Reading import (`src/lib/actions/reading-import.ts`, SLN-450)

Each action parses its input with zod (`src/lib/validations/reading-import.ts`). The upload is the route `POST /api/reading/import`. The work happens in `src/lib/reading/import/store.ts`; matching in `match.ts` and `match-rules.ts`. No activity event: no event type fits an import, and the imports list records it.

### `decideImportRow({ importId, rowNo, decision?, workId?, useFileRating? })`
One UPDATE of one row: Import, Skip, or "Use the file's rating" (the commit then sends `bookRating: "replace"`). With `workId` ("Choose another book", a candidate): the book must be a book (`requireBookWork`); the row's book is set, its readings and the other rows of the same books are checked again against the duplicate rule, and the decision becomes import (skip when every read is already there). Refused on a row already written ("This row was imported; undo the import to change it"), and Import on a row that cannot be imported, has no book, or whose reads are all present except through the undated count.

### `decideImportSection({ importId, section, decision })`
`section` is `likely` ("Accept all likely matches") or `none` ("Skip all not in Durtal"): one UPDATE over the section's pending rows not yet written. Returns `{ changed }`.

### `rematchImport({ importId })`
"Match again": matching and the duplicate check again for the rows still without a book, after a book was added. A row that now matches moves to its section with that section's default decision. Returns `{ matched }`.

### `commitReadingImport({ importId })`
Locks the import (`select ... for update`, status pending, completed or undone), checks every matched row's readings again against what Durtal holds now, and writes the rows decided import and not yet written through `writeReadings(rows, { source: "import", importId })`. `source`, `sourceKey` and `importId` come from the server, never from the page. A book's rows go in one call, so the count rule sees them together, in chunks of at most 100 readings; after each chunk, each row's outcome goes to `written` in one UPDATE. Totals: the file's Durtal value, else the edition's `page_count`, else Goodreads' `Number of Pages`, never below the position. An edition matched by ISBN that has no `goodreads_id` gets a `catalogue_identifiers` row (provider `goodreads`, kind `edition`) when the file has a Book Id and that id is free; its id goes into `written`. Then the import's counts, `error_log` (row and reason only), status `completed` and `completed_at`. A commit stopped half way finishes when run again. Returns `{ written, present, refused, rows }`.

### `undoReadingImport({ importId })`
Deletes the import's readings not edited since (their `updated_at` equals their `created_at` and they have no sessions), any reading with this `import_id` included, in chunks of 100. Puts each book rating back to `before` only while `works.rating` still equals `after`; removes the identifiers it added; keeps in `written` only the readings it kept; status `undone`. Returns `{ removed, kept }`. Can be run again; an undone import keeps its decisions and can be committed again.

### Import queries (`src/lib/reading/import/page-data.ts`, not server actions)
- `listReadingImports(limit)`: the reading imports, newest first, with their counts, readings and whether the raw file was kept.
- `getImportPreview(importId, limits)`: the import, the section counts and the summary (rows, want to read, private notes, kept extras, pending, ratings that differ, readings to import, identifiers to record), and each section's first rows (50 by default) with the matched book and the To choose candidates. Reviews and private notes stay in the database.

---

## Taxonomy (`src/lib/actions/taxonomy.ts`)

Reads only. Subjects, genres, tags and every other family are created, renamed, merged and deleted through the family registry in `src/lib/actions/taxonomy-families.ts` (`createTaxonomyItem`, `updateTaxonomyItem`, `deleteTaxonomyItem` and the rest).

### Subjects

```typescript
getSubjects(): Promise<Subject[]>
```

### Genres

```typescript
getGenres(): Promise<Genre[]>
```

Genres support hierarchy via `parentId`. Deleting a parent sets children's `parentId` to null (SET NULL).

### Tags

```typescript
getTags(): Promise<Tag[]>
```

---

## Media (`src/lib/actions/media.ts`)

### `getMediaForWork(workId)` / `getMediaForAuthor(authorId)`

```typescript
getMediaForWork(workId: string): Promise<Media[]>
getMediaForAuthor(authorId: string): Promise<Media[]>
```

Returns all media ordered by `sortOrder`.

### `createMedia(input)`

```typescript
createMedia(input: CreateMediaInput): Promise<Media>
```

Validates that exactly one of `workId` or `authorId` is set (XOR). Validated against `createMediaSchema`.

### `deleteMedia(id)` / `bulkDeleteMedia(ids)`

Deletes the media records first, then their S3 objects (full image, thumbnail and original). A file that another row still stores is kept. `deleteMedia` makes the next image of the same type active when it deletes the active one.

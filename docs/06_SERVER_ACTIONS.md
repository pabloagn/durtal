# Server Actions

All database operations in Durtal are performed through server actions (`"use server"` functions). These are the business logic layer — they validate input, execute queries, manage relationships, and handle S3 operations.

Server actions are called directly by server components and client components without an HTTP round-trip for server-rendered pages.

---

## New books queue their identity and research jobs (SLN-464, SLN-469)

After its save commits, each of these actions queues the book's identity job and its research job with `queueNewBookEnrichment(workId)` (`src/lib/enrichment/queue.ts`): `createWork`, `createBookFromWizard`, `fastTrackBook` (`src/lib/actions/fast-track.ts`), `createOrderForNewBook`, `createEdition` when the edition has an ISBN, and `identifyEdition` when a placeholder gets its ISBN. The job's priority is the book's scope: owned 10, on order 20, wanted 30, the rest 100; a bulk e-book accession passes `BULK_ACCESSION_PRIORITY` (200). An open job of the book is merged, not duplicated. A book already researched queues its identity job only, so a new edition searches nothing again; a research job skipped because the book had no author does not count (SLN-530). Queueing spends nothing: research spends only when the worker runs `--apply --kinds research`. The queue never fails a save: a failure is logged with `[enrichment]`. The worker (`scripts/enrichment/worker.ts`) works the jobs by hand. When an edition's ISBN changes later, re-queue it with `--enqueue identity --only SLUG`.

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

Book enrichment (SLN-462): a work's claims may cite this edition's source records, which go with it. The delete is one unit: it refuses while an accepted claim's evidence all cites them ("An accepted enrichment value rests only on this edition's sources. Undo that value first."), otherwise it deletes that evidence, rejects the proposals left with none (`check`, `evidence_deleted`), and deletes the edition with its own claims.

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

A live check of one outside service (`src/lib/settings/integrations.ts`): database (`select 1`), storage (`HeadBucket`, and the bucket's region against `AWS_REGION`), ISBNdb, Google Books, Open Library (one known ISBN), Google Places (ids only), Nominatim (`/status`), Wikidata, the evidence fetcher (an outlet's robots.txt), the enrichment budget (the ledger, no call), Tavily (`GET /usage`, free), Brave Search (one search of `count=1`, metered as operation `check`; at the budget cap it makes no call and warns) and the extraction model (`models.retrieve("claude-opus-5-5")`, free). Each has an 8 s limit and no cache. The message never holds a URL, header, body or secret. Mapbox is checked by the browser. Never called from `/api/health`.

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

## Book enrichment (`src/lib/actions/enrichment.ts`, SLN-462)

The inbox of SLN-470 and the book page read a book's claims and decide them here. The services behind them live in `src/lib/enrichment/` (`claims.ts`, `targets.ts`, `jobs.ts`, `loader.ts`, `governance.ts`) and take a connection, so scripts run the same code inside one postgres-js Drizzle transaction. Each write reads and checks first, makes its ids up front, then writes in one atomic unit with a row lock and a fingerprint check. Activity is recorded after the commit, and every apply or undo invalidates `CACHE_TAGS.works`.

### `getWorkEnrichment(workId)`

The book's claims, newest first, each with its evidence (excerpt, outlet, URL, retrieval date, extractor version) and a `fingerprint`: md5 of the claim, its evidence ids and its target's current value. Also its accepted values (the governed items its accepted claims link, and its value rows) and its applies.

### `acceptEnrichmentClaims(items)`

1 to 20 `{ claimId, fingerprint }`; one `batchId` names the call. Each item stands alone and returns in `applied` (with its `applicationId`) or `failed` (with a reason). An item is refused when its fingerprint is stale, the claim is no longer proposed, or its target refuses (an ID of that provider already there, an ID owned by another record, "No writer for <target>"). An apply writes the target (a taxonomy link of the term's item, a value row, a `works` column or a `catalogue_identifiers` row), sets the claim `accepted`, supersedes the dimension's other open proposals on a single-value dimension and the value it replaces, and logs one `enrichment_applications` row with `before` and `after`. Records `work.enrichment_applied`.

### `rejectEnrichmentClaims(items)`

1 to 20 `{ claimId, fingerprint, reason, note? }`; reasons `wrong_value`, `weak_evidence`, `wrong_book`, `not_independent`, `other`. Only a proposed claim is rejected. A value rejected as `wrong_value` or `wrong_book` is never proposed again; after another reason, only a proposal citing a new source record opens it again.

### `createHumanEnrichmentClaim(input)`

Pablo's edit: `{ workId, editionId?, dimension, value, note? }`, where `value` is `{ term }`, `{ number }`, `{ text }`, `{ placeId }` or `{ personId }` as the dimension's kind takes. Calls `requireBookWork` first. The claim is `human`, accepted by `pablo` and applied at once in the newest vocabulary version; the claim it replaces becomes superseded. Records `work.enrichment_applied`.

### `undoEnrichmentApplication(id)` / `undoEnrichmentBatch(batchId)`

Per-item results `{ undone, failed }`; a batch is undone newest first. An undo restores `before`: the target's value and every claim status the apply changed. Superseded proposals reopen, except one whose value has a newer open claim; the applied claim goes back to proposed, and no rule ever applies it again; a human claim the apply created becomes rejected (`undone`). Refused when the target changed since ("The value changed since it was applied; undo it from its newer apply first"), and for a removal by hand. Records `work.enrichment_undone`.

### Hand edits of governed items

`updateWorkTaxonomy` and the wizard read the governed items of the families they edit first (`readWorkTaxonomyGovernance`), and `workTaxonomyQueries` writes, in the same batch; `replaceTaxonomyAssignments` does the same for a book's family edited in place on the book page, a custom family included: a governed item Pablo adds becomes his accepted human claim with its apply (note "added by hand"), superseding an open proposal of that value; a governed item he removes rejects its accepted claim (`wrong_value`, note "removed by hand") with an apply row, so it is never proposed again. Items no term governs behave as before, and `work.taxonomy_added` and `work.taxonomy_removed` stay.

### Services for scripts (`src/lib/enrichment/`)

- `proposeClaims(items, conn?)`: writes proposals with their evidence, one unit per item, and returns `created`, `merged` (evidence added to the open claim of that value, which takes the new confidence), `skipped` (accepted already, its item linked already, rejected for good, or rejected on the same sources; an R6 rejection's evidence from an undone extraction run does not count) or `refused` (unknown or retired term, wrong kind, a human proposal without Pablo's `storygraph_export` evidence, or an evidence guard). A concurrent proposal of the same value is retried as a merge.
- `applyClaim(claimId, by, conn?)`: by Pablo, or by an enabled rule, which also needs the claim's confidence at its minimum, an `api` or `agent` claim never undone, an empty target, and room under its daily cap in a rolling 24 hours (`src/lib/enrichment/rules.ts`: 100 for exact identity links, `DAILY_EXACT_IDENTITY_APPLY_CAP`; 20 for every other rule apply, `DAILY_RULE_APPLY_CAP`; SLN-461's v1 proposal), counted under a transaction advisory lock.
- `undoApplication(id, conn?)`, `createHumanClaim(input, conn?, { batchId?, note?, evidence? })` and `rejectClaim(claimId, { reason, note? }, conn?)`: the actions' services. Pablo's own claim may cite the source that confirms it (the identity review file does). A rule apply can carry a batch: the worker's run id, so `--undo RUN_ID` finds it.
- Jobs (`jobs.ts`): `enqueueEnrichmentJob` (folds into the open job of that book and kind; a running one runs again), `claimNextEnrichmentJob({ worker, kinds, jobIds?, workIds? })` (one `UPDATE … SKIP LOCKED` statement; takes an abandoned lease after 30 minutes; every claim counts an attempt; the fifth abandoned attempt fails), `finishEnrichmentJob` (stores `payload.outcome`; a rerun queues again with its attempts back at zero), `failEnrichmentJob` (retries after 2^attempts minutes, fails after five), `holdEnrichmentJob` (gives the attempt back and drops a pending rerun), `renewEnrichmentJobLease` (the worker's heartbeat: renews a running job's lease while its worker still holds it), `releaseHeldEnrichmentJobs(kind?)` (releases quota, rate-limit and budget holds; a book's cost ceiling waits for Pablo).
- The vocabulary loader (`loader.ts`, run by `scripts/enrichment/vocabulary.ts`): `planVocabulary`, `applyVocabulary` and `undoVocabulary`. The only code path that creates terms (R4).

---

## Reading (`src/lib/actions/reading.ts`, SLN-444)

Every write parses its input (`src/lib/validations/reading.ts`), checks the book (`requireBookWork`), reads the reading and its fingerprint, then runs one atomic write that locks the reading and asserts the fingerprint; a stale one gives "This reading changed elsewhere; reload before saving". Each returns the reading with its new fingerprint, records its history entry after the write, and invalidates `works` and `reading`. Ratings are 0.5 to 5.0 in half steps. Times and default dates use the browser's `timeZone` when given, else `APP_TIMEZONE`, and the reading day: hours before `app_settings.reading_day_start_hour` (04:00 by default) count for the evening before. Every writer reads the hour with `readingDayStartHour()` (`src/lib/reading/day.ts`); no caller passes a literal hour.

### `startReading(input)`
Starts a book: copy, edition, home, format (from the copy: e-book files are `ebook`, audiobooks `audio`), unit, totals (pages from the edition), start date (today's reading day, or unknown) and at most one start position. Refused while the book has an open reading ("This book is already being read", or "This book has a paused reading; resume it"). `work.reading_started`.

### `logProgress(input)`
A page, percent, minutes, pages or minutes on, or a chapter, in the reading's edition or another of the book's. A paused reading resumes first. A new session starts where the session order says and ends at the new place; going back follows `goingBack` (`fix_last_log` replaces the latest session's end, `went_back` writes a session that counts nothing; without it, a log on the latest session's day fixes it). Past the last page or the end is refused with the page or time. A session after today, or with a start or end more than a minute ahead, is refused: "This session is in the future" (it would be the latest and hold the position until that day). Returns `{ reading, session, reachedEnd, wentBack, undo }`. `work.reading_progress` at most once per reading per day.

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
Edition or copy (the start and current positions are mapped by share; with no page count, page null and unit percent; `work.reading_edition_changed`), format, unit, home (physical only), totals (never below the position: "You are on p. 212; the book cannot have 200 pages"), dates (the finish only on a finished or abandoned read, after the start), rating, review, reason and note. With a new edition and `moveNotes: true` (SLN-480), the same `atomic` files the reading's notes on its old edition (or with none, when it had none) under the new one: the page and the percent stay, `updated_at` stays, and notes naming another edition never move. `getReadingsForWork` gives each reading `ownEditionQuoteCount` and `ownEditionNoteCount`, for Edit reading's checkbox.

### `deleteReading(input)` / `restoreReading(snapshot)`
Deletes a reading with its sessions and history and returns the snapshot; restore puts it back with the same ids, an edition, copy or place deleted meanwhile coming back empty, and is refused if it would make a second open reading. `work.reading_deleted`. Its quotes and notes (SLN-453) stay with the book without a reading; the snapshot holds their ids (`noteIds`) and restore links back the ones still without a reading on the same book.

### `updateSession(input)` / `deleteSession(input)`
Edit or remove one session (not the running timer); the next session's start and the open reading's position follow. An edit that moves a session after today is refused, as in logProgress. With no session left, the position returns to the start. `deleteSession` returns `{ reading, session }`: the deleted row, for its Undo.

### `addSession(input)` / `restoreSession({ readingId, fingerprint, snapshot })` (SLN-451)
`addSession({ readingId, fingerprint, readOn, startedAt?, endedAt?, durationSeconds?, to: { page | percent | minutes }, chapter?, editionId?, format?, note?, timeZone })` adds one session by hand: `recordProgress` with `source: "manual"` and `goingBack: "went_back"`, so it never replaces another. It takes its place in the session order: it starts where the session before it ended, the next session's start follows, and the position moves only when it is the newest. Open readings only; `startedAt` and `endedAt` must fall on `readOn` in `timeZone`, and nothing may be in the future. Its Undo is `deleteSession`. `restoreSession` is the Undo of a delete: it puts the row back with its id and source and recomputes the next start and the position; refused for a running timer.

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
A book's readings newest first (fingerprint, ordinal, sessions and time, edition with translators, copy and shelf, home); every open reading with its book, author, cover and when it was paused, most recently read first (the hub, the dashboard, and the command palette, which calls it each time it opens); the readings, sessions, quotes and notes a book delete removes (`{ readings, sessions, quotes, notes }`, one query). A book's readings also carry `quoteCount` and `noteCount` (SLN-453), for the delete dialog's "Its 2 quotes and 1 note stay with the book".

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
- `createReading(input, { source, sourceKey?, importId? })`: the start every writer shares; with a known source key it returns that reading unchanged. It takes the book off Up Next in the same write and says so (`unqueued: true`, SLN-452).
- `recordProgress(input, { fingerprint?, source, editionId?, format? })`: the progress write. Without a fingerprint (REST, the timer, the reader) it builds the write from a fresh read, asserts it, and retries once ("This reading changed elsewhere; try again"). With `timerSessionId` (SLN-451) it completes that running timer row instead of inserting a session, keeping its zone and day, and asserts in the same atomic that the row still runs.
- `writeReadings(rows, { source, importId? })`: the batch writer for imports, the seed, the backfill and past reads. Each row is validated, checked with the duplicate rule (the count rule for imports), refused when it would open a second reading, and written with its history row, at most 100 per atomic; a repeated run writes nothing again. The book's rating is set `if_none` or `replace`, with `{ before, after }` in the outcome. `allowPossibleDuplicate` writes a possible duplicate, and an undated read the import's count rule called present ("Import anyway"). An open or paused row takes its book off Up Next in the same write (`unqueued: true` in its outcome, SLN-452).

---

## Up Next (`src/lib/actions/reading-queue.ts`, SLN-452)

Each action parses its input with zod (`src/lib/validations/reading-queue.ts`), writes books only (`requireBookWork`), runs one `atomic` inside `withReadableErrors`, and invalidates `works` and `reading` (the library's filter and sort read the queue). `work.queued` and `work.unqueued` are recorded after the write, at most one each per book per reading day; items an import adds record none. Up Next never changes `catalogue_status`. Position arithmetic, the edition he means, where the copy is and time to read are pure, in `src/lib/reading/queue.ts`.

### `addToQueue({ workId, editionId?, note?, at?: "top" | "bottom", from?: "suggestion" })`
At the bottom unless `at: "top"`; `from: "suggestion"` stores `source = 'suggestion'`, else `manual`. Refused for a queued book ("Already in Up Next, at 3"), a book being read ("Nadja is being read", "Nadja has a paused reading") and an edition of another book. Returns `{ workId, place }`.

### `addManyToQueue({ workIds })`
The bulk toolbar's: appended in the given order in one write; queued books and books being read are skipped and counted. Returns `{ added, alreadyQueued, beingRead }`.

### `removeFromQueue({ workId })` / `restoreQueueItem(snapshot)`
Remove returns the deleted row, for its Undo. Restore puts it back with its id at its old position, or the next free one after it; an edition deleted or moved meanwhile comes back empty. Refused when the book was queued again ("Nadja is in Up Next again") or started meanwhile.

### `moveQueueItem({ workId, beforeWorkId?, afterWorkId? })`
Places the item after `afterWorkId` (the item above) and before `beforeWorkId` (the item below): the middle of the gap, or, with no gap left, every position renumbered in steps of 1024 in the same write. Returns `{ workId, place, total }`.

### `updateQueueItem({ workId, editionId?, note? })`
The edition he means to read and the note.

### `getQueue({ homeId? })`, `getQueueHead(limit)`, `getQueuePlace(workId)`
The whole list in one query, in order: each book with its author, covers, editions and copies (for the edition he means: the queued one, else `pickDefaultEdition` for the home; and where the copy is, through `copyWhereabouts`), each edition's last known audio length (`total_minutes` of its latest reading that has one), ownership (`ownedBookCondition`), the copy at hand at the home (`atHandCopySql`) and the reading history (`readCountSql`, `lastFinishedOnSql`). The hub's strip reads the first five; the book page reads its place.

## Bulk Mark as read (`src/lib/actions/reading-bulk.ts`, SLN-463)

The library's selection toolbar marks books read in bulk. Each input is parsed strictly with zod (`markWorksReadSchema`, `undoMarkWorksReadSchema` in `src/lib/validations/reading.ts`): ids are UUIDs, 1 to 1000 of them, and any other key (a `source`, a `sourceKey`) is refused before any database call. Books only (`requireBookWorks`). Both invalidate `works` and `reading` after a change. Feedback never creates a reading: nothing here writes `recommendation_feedback`.

### `markWorksRead({ workIds, confirmDuplicates? })`
Gives each selected book one finished reading with both dates unknown, through `writeReadings(rows, { source: "manual" })`: no source key, the format of the book's copies that are not deaccessioned when they all read in one (`formatOfCopies`), else print. A book being read or paused gets no row and is reported ("being read: finish it on the book page"). A possible duplicate (`duplicateVerdicts`, for example a book already read) is reported with the read it matches and written only when its id is in `confirmDuplicates`. The rows go 100 at a time, one `writeReadings` call (one `atomic`) each: when one fails, the earlier ones stay written and the error says how many; the same selection again writes the rest, and the books written before come back as possible duplicates. Records `work.reading_finished` (`past: true`) for each reading written. Up Next is left as it is. Returns `{ marked, readingIds, possibleDuplicates, skipped }`.

### `undoMarkWorksRead({ readingIds })`
The toast's Undo, with the ids one `markWorksRead` call returned. Deletes only those readings, and only while each is as written: source `manual`, no source key, finished with both dates unknown, `updated_at = created_at` and no session (the import undo's rule). The check is repeated in the delete itself, 100 at a time, each in `atomic` inside `withReadableErrors`. A reading changed since is kept and reported with its reason. Records `work.reading_deleted` for each reading removed. Returns `{ removed, kept }`.

## Reading goals and rhythm (`src/lib/actions/reading-goals.ts`, SLN-455)

Each input is parsed with zod (`src/lib/validations/reading-goals.ts`). Goal writes run in one `atomic` inside `withReadableErrors` and invalidate `reading`. No activity events. Progress and the rhythm are computed per request, never cached, one query each; every number comes back as a number (`float8`). The words, the expected share and the week are pure, in `src/lib/reading/goals.ts`.

### `setReadingGoal({ year, metric, target, countRereads?, excludedWorkTypeIds? })` / `removeReadingGoal({ year, metric })`
Sets a year's goal for books, pages or hours (1 to 100,000), replacing the one there (one per metric per year), or removes it; removing a goal that is not there changes nothing.

### `getGoalProgress(year)`
The year's goals, each with its count (books; pages from `countedPagesSql`, summed then rounded; hours from ended sessions, the running timer left out), the reading day the count reached the target and that unit's precision, the count over the 90 days up to today (the pace line), the average pages of the books it counts this year and last, the audiobooks without a page count, and the names of the work types it leaves out. A re-read (`rereadSql`) counts only with `countRereads`; a book of an excluded work type never.

### `getGoalHistory()` / `getGoalDialogData()`
Every past year's goals with their results, in one query; and what the goal dialog needs: this year's and next year's goals, the work types and the past years.

### `getRhythm()`
`{ target, weekStart, today, days }`: the days he would like to read each week (null: off), the week start, the server's reading day, and his reading days from the 12 weeks before yesterday's week to tomorrow, with a day to spare on each side (`rhythmRange`, so a browser a day behind the server still has its oldest week): days with an ended session (by `read_on`; the running timer never counts) or a finish at day precision. The browser builds this week and the 12 before it with `rhythmView`.

## Suggestion feedback (`src/lib/actions/suggestions.ts`, SLN-457)

Not now, Never and Not for me on a suggested book, in `recommendation_feedback` (one row a book, shared with the book enrichment epic). Each input is parsed with zod (`src/lib/validations/suggestions.ts`; the reasons' schema is built from `FEEDBACK_REASONS`), books only (`requireBookWork`), one `atomic` inside `withReadableErrors`, then `invalidate(CACHE_TAGS.reading)`. No activity events.

### `setSuggestionFeedback({ workId, verdict, reasons?, note?, until? })`
An upsert on `work_id`: `not_now` (hidden until `until`, 30 days after today's reading day by default), `never`, or `rejected` (at least one reason: "Pick a reason"). The newer verdict replaces the older; `reasons`, `note` and `until` are replaced, not merged; `source` becomes `suggestions`; `updated_at` is now. Returns the row it replaced, or null, for Undo.

### `removeSuggestionFeedback({ workId })` / `restoreSuggestionFeedback(snapshot)`
Remove deletes the row and returns it (the Hidden view's Undo: the book is a candidate again). Restore puts a previous row back as it was, its source and dates included (the Undo of a verdict that replaced it, or of a removal).

### `getSuggestionContext({ homeId?, now? })` (`src/lib/reading/suggest/context.ts`)
Not an action: what the suggestions page, the hub, the book page and the API read. One query for every book (`loadBooks` in `load.ts`, which the evaluation script also runs), plus the homes, Up Next's length, his pace and two settings; never cached. Its numbers come back as numbers (`float8`). When the prediction gate's last check is 24 hours old it runs `evaluatePredictions` and writes the result with one UPDATE asserting the old `checkedAt`, so two requests never both write it.

## Reading stats (`src/lib/reading/stats.ts`, SLN-456)

Server functions for `/reading/stats`, the Year in review and On this day: not server actions (no page calls them from the browser), and never cached. Each takes a year, or `null` for all time, and returns plain numbers (every numeric column and average cast to `float8`), from a handful of aggregate queries, never one per book. The rules every section follows:
- **Pages** come only from `countedPagesSql`, filtered by its day and precision, summed, then rounded. An audiobook without a page count counts none, and each section that shows pages says how many it leaves out.
- **Hours and reading days** come from ended sessions; the running timer never counts. A reading day has an ended session (by `read_on`) or a finish at day precision.
- **Ratings** are the read's (`readingRatingSql`) everywhere but the recommenders, which use taste evidence (`tasteRatingSql`). A rating on a book with no finished read appears nowhere.
- **Dates**: a year's charts take day and month precision; a reading dated only by the year counts in the totals and in a "Month unknown" bar; an unknown date counts in the all-time totals only. Day charts use sessions only, by `read_on`; weekday and time of day use each session's local start (`started_at at time zone time_zone`).
- **Where** groups by the reading's home (`readings.location_id`), never by a copy's place now. **Owned** is `ownedBookCondition`.

### `yearNumbers(year)`, `overTheYear(year)`, `readingDays(year)`, `ratings(year)`, `lengthAndPace(year)`, `languages(year)`, `authorStats(year)`, `eras(year)`, `whereAndHow(year)`, `shelfTime(year)`, `recommenderStats(year)`, `abandoned(year)`, `insightInputs(year)`
The stats page's sections, one function each. Shelf time counts a book when its first reading's start has day or month precision and is on or after the earliest acquisition date of its copies that are not deaccessioned; the others are counted for the footnote. Formats count per session, so a session in an audiobook edition of a print reading is audio; a finished reading without sessions counts under its own format. Insights (`src/lib/reading/insights.ts`) speak only with at least 5 books in each group and a difference of half a star or 20%.

### `unreadPile(today)`
Always all time: the owned books whose reading state is unread (the library's `reading=unread&holding=owned`, same count), their pages (the edition of the first copy that is not deaccessioned, else the largest edition), those without a page count, the pages a year over the last three years, the years the pile would take at that pace, and the books with a copy at hand per home (`atHandCopySql` for each of `homeOptions`).

### `statsYears()` / `finishedYears()`
The years the stats page offers (any reading or session with a known date), and the years with finished books with their counts (the Year in review list).

### `onThisDay(days)`
Books finished or started on these days' calendar dates in earlier years, day precision only, at most three a day, finishes first, with the read's rating.

### `yearReview(year)`
The year's numbers, its finished books in finish order with their covers and month (null when dated only by the year), the first and last book (day or month precision), the longest, the highest rated, the most re-read, the busiest month and the favourite passage.

## Reading export (`src/lib/actions/reading-export.ts`, SLN-458)

### `getGoodreadsExportNotice()`

What the Goodreads export says before it downloads: `{ books, halfStars }`, the books the file holds and how many of the ratings it carries are half stars, which Goodreads rounds up (`roundsHalfStar`, `src/lib/export/goodreads.ts`). A book never finished nor abandoned carries no rating, so it is not counted. Reads only. The files themselves come from `POST /api/export` (docs/05).

## Quotes and notes (`src/lib/actions/reading-notes.ts`, SLN-453)

The commonplace book. Each write parses its input with zod (`src/lib/validations/reading-notes.ts`), writes books only (`requireBookWork`), reads and checks the reading and edition against the book ("This reading belongs to another book", "This edition belongs to another book"), runs one `atomic` inside `withReadableErrors`, then records activity and invalidates `works` and `reading`. `source`, `sourceKey` and `importId` are never taken from a page: page actions write `source: "manual"`. No event per note: at most one `work.notes_added` per book per reading day ("Added 3 quotes and 1 note"), recorded after the write; the first note of the day records it and later ones add to its counts. Notes an import writes record none. Pure rules: `src/lib/reading/notes-text.ts` (`joinHyphenatedLines`, `parsePageInput` and `formatPageInput`, `pageText`, `noteWhereText`, `noteCitation` and `formatNoteForCopy`, `noteGroups`, `keptNotesText`), `src/lib/reading/edition-label.ts` (`editionShortLabel`, `editionLabels`, `noteEditionsOf`, SLN-480), `src/lib/reading/note-defaults.ts` (the dialog's edition and mode), `src/lib/reading/notes-params.ts` (`parseNotesQuery`) and `src/lib/reading/passage.ts` (`choosePassage`).

### `createReadingNote({ workId, kind, body, readingId?, editionId?, page?, endPage?, pageRoman?, chapter?, percent?, commentHtml?, commentJson?, isFavourite? })`
`kind` is `quote` or `note`; the body is trimmed and keeps at least one character, at most 10,000. `references()` gives a note on a reading the reading's edition when the caller names none (the note dialog always names one, SLN-480). `endPage` comes after `page` ("The last page comes after the first") and needs it ("Send the first page with the last"); `pageRoman` needs a page of 1 or more ("A roman page starts at i"). Both are refused, not dropped, when sent with no page; an edit that takes the page away takes them with it; a non-null percent with a non-null page is refused ("Send a page or a percent, not both"). The percent, when not given, is worked out against the note's own edition: `percentOf` the page and the reading's `total_pages` when the reading is on the note's edition, else the edition's `page_count`, else null; null for front matter. Example: a reading on edition A (400 pages) and a quote at p. 120 under edition B (300 pages) stores 40.00; moved to A in Edit, 30.00. Only a quote carries a thought ("Only a quote carries a thought"): `commentHtml` is sanitized with `sanitizeCommentHtml`, and an editor with no text stores none. Returns the note as the pages show it (`NoteItem`, with its reading's number).

### `updateReadingNote({ id, ...patch })` / `toggleNoteFavourite({ id })`
Any field of the create but the book. Another reading brings its edition unless an edition is sent; no reading, or a reading with no edition, keeps the note's (SLN-480). The page rules hold on the fields as they will be stored. The percent is worked out again only when the page, the edition or the reading changes (a note with no page keeps its typed percent), unless one is sent; the edition changed by hand keeps the page as typed. A quote that becomes a note loses its thought. The star flips `is_favourite` and, like any edit, moves `updated_at`, so an import's undo keeps a starred note.

### `deleteReadingNote({ id })` / `restoreReadingNote(snapshot)`
Delete returns the row, for the page's 10-second Undo. Restore puts it back with the same id, its `end_page` and `page_roman` included (a snapshot from before SLN-480 has neither); a reading, edition or import deleted meanwhile comes back empty.

### `getNotesForWork(workId)`
A book's quotes and notes in an edition group's order (SLN-480): front matter, other pages, percent-only notes, notes with no place, ties by the date added; each with its reading's number ("2nd read", `readingOrdinalSql`). The book page groups them by edition (`noteGroups`).

### `searchNotes({ q?, workId?, authorId?, editionId?, translatorId?, kind?, favourites?, year?, sort, order?, page, perPage? })`
The commonplace book: `textSearchCondition` and `textSearchRank` on `reading_notes.search_text` (accents and a one-letter typo forgiven), the book, any author of the book, the edition (`none`: no edition recorded) and a translator of the note's edition (SLN-480), the kind, the star and the year added (the app's zone). Sorts: `newest`, `book` (title, then the edition groups in the book page's order, `publication_year desc nulls first`, then the edition id, no edition last, then each group's order) and `relevance` (a search only). 48 a page unless `perPage` is another of the page sizes. Returns `{ items, total, page, pageCount, noteEditions }`; each item has its book's id, title, slug and first author, and `noteEditions` holds each edition the page's notes use, once (`{ label, title, publisher, year, translators }`). `getNotesFacets(workId?)` gives the filters' choices: the books, the authors and the years that have notes, the total, the translators of notes' editions, and for the chosen book its editions that have notes (labelled, in the book page's order) and the count of notes with no edition. `getPersonNoteCounts(authorId)` counts, in one query, the notes on a person's books and those on editions they translated, for the people page.

### `getPassageOfTheDay({ day, offset? })`
The hub's passage: `choosePassage(quotes, day, offset)` over every quote, then that quote with its book. `offset` is "Another", counted in the browser only. Returns `{ note, candidates, edition }` (its edition's summary, SLN-480), or null without quotes.

## Reading import (`src/lib/actions/reading-import.ts`, SLN-450)

Each action parses its input with zod (`src/lib/validations/reading-import.ts`). The upload is the route `POST /api/reading/import`. The work happens in `src/lib/reading/import/store.ts`; matching in `match.ts` and `match-rules.ts`. No activity event: no event type fits an import, and the imports list records it.

### `decideImportRow({ importId, rowNo, decision?, workId?, useFileRating? })`
One UPDATE of one row: Import, Skip, or "Use the file's rating" (the commit then sends `bookRating: "replace"`). With `workId` ("Choose another book", a candidate): the book must be a book (`requireBookWork`); the row's book is set, its readings and the other rows of the same books are checked again against the duplicate rule, and the decision becomes import (skip when every read is already there). Refused on a row already written ("This row was imported; undo the import to change it"), and Import on a row that cannot be imported, has no book, or whose reads are all present except through the undated count.

### `decideImportSection({ importId, section, decision })`
`section` is `likely` ("Accept all likely matches") or `none` ("Skip all not in Durtal"): one UPDATE over the section's pending rows not yet written. Returns `{ changed }`.

### `decideImportNote({ importId, rowNo, decision })` / `decideAllImportNotes({ importId })` (SLN-453)
A row's Goodreads private note: one UPDATE of `note_decision`, apart from the row's reading decision. Refused once the note was written ("This note was imported; undo the import to change it"), for a row without a note, and Import for a row without a book ("Choose this row's book first"). "Import all private notes" sets every note with a book and not written to import in one UPDATE; returns `{ changed }`. `decideImportRow` and the readings' commit look only at the reading outcomes in `written` (`readingsCommitted`), so a row whose note is in can still be decided and committed for its readings; choosing another book for it is refused while its note is in.

### `rematchImport({ importId })`
"Match again": matching and the duplicate check again for the rows still without a book, after a book was added. A row that now matches moves to its section with that section's default decision. Returns `{ matched }`.

### `commitReadingImport({ importId })`
Locks the import (`select ... for update`, status pending, completed or undone), checks every matched row's readings again against what Durtal holds now, and writes the rows decided import and not yet written through `writeReadings(rows, { source: "import", importId })`. `source`, `sourceKey` and `importId` come from the server, never from the page. A book's rows go in one call, so the count rule sees them together, in chunks of at most 100 readings; after each chunk, each row's outcome goes to `written` in one UPDATE. Totals: the file's Durtal value, else the edition's `page_count`, else Goodreads' `Number of Pages`, never below the position. An edition matched by ISBN that has no `goodreads_id` gets a `catalogue_identifiers` row (provider `goodreads`, kind `edition`) when the file has a Book Id and that id is free; its id goes into `written`. Then the import's counts, `error_log` (row and reason only), status `completed` and `completed_at`. A commit stopped half way finishes when run again. Then the to-read rows decided import (SLN-452): Up Next items at the bottom, in the file's Date Added order, oldest first (file order without it), in chunks of 100, `source` `import` with `import_id` and the row's `source_key`; a key already in Up Next writes nothing, and a book queued by hand or started meanwhile is skipped with its reason. Each written item goes into `written.queueItem` (`{ id, workId, position, editionId, note }`). Then the private notes (SLN-453) of rows decided import, with a book and no note written: each becomes a `reading_notes` row (`kind` note, `source` import, `import_id`, the private note with its tags stripped and its line breaks kept, the row's latest read in Durtal, written by this commit or matched as already there, else none, that reading's edition when it is on the note's book (SLN-480), and `source_key` from `goodreadsNoteKey`), and its id goes to `written.noteIds` in the same write. A key already in Durtal writes nothing ("Already in Durtal (Same source)"); a note over 10,000 characters is left out ("Too long to import (12,400 characters; at most 10,000)"). An import committed before this step writes only its notes. Returns `{ written, present, refused, rows, queued, queuePresent, queueSkipped, notes, notesPresent }`.

Each rating change saves its original and final value in `reading_import_rows.written` in the same atomic transaction as the reading and rating. Goodreads identifier inserts save their undo ids in the same SQL statement. These journals survive a lost response or failed summary update; retry preserves them, and undo can recover them before the import completes. A row with a durable rating or identifier journal cannot change its book or reading decisions until undone; it can still be retried.

### `undoReadingImport({ importId })`
Deletes the import's readings not edited since (their `updated_at` equals their `created_at` and they have no sessions), any reading with this `import_id` included, in chunks of 100. Puts each book rating back to `before` only while `works.rating` still equals `after`; removes the identifiers it added; keeps in `written` only the readings it kept; status `undone`. Up Next items (SLN-452) go when their position, edition and note still equal what was written; moved or edited ones stay. Notes (SLN-453) go first: the import's notes not edited since (`updated_at` equals `created_at`), those in `written.noteIds` and any the rows miss; then `noteIds` is cleared, and edited notes stay. Returns `{ removed, kept, queueRemoved, queueKept, notesRemoved, notesKept }`. Can be run again; an undone import keeps its decisions and can be committed again.

### Import queries (`src/lib/reading/import/page-data.ts`, not server actions)
- `listReadingImports(limit)`: the reading imports, newest first, with their counts, readings and whether the raw file was kept.
- `getImportPreview(importId, limits)`: the import, the section counts and the summary (rows, want to read, private notes, kept extras, pending, ratings that differ, readings to import, identifiers to record), and each section's first rows (50 by default) with the matched book and the To choose candidates. Reviews and private notes stay in the database. A row with only its note written shows as not committed.
- `getImportNotes(importId, limit)` (`src/lib/reading/import/notes.ts`, SLN-453): the rows with a private note, their count, the notes a commit would write, and the first `limit` rows with the note's first three lines, the matched book and each note's state (to import, skipped, pending, imported, already in Durtal, too long, no book).

---

## Perfume sources (`src/lib/actions/perfume-sources.ts`, SLN-377)

Wikidata is the one perfume source with a documented public API
(`src/lib/providers/wikidata-perfumes.ts`, through the provider contract of
`src/lib/providers/run.ts`). Fragrantica, Basenotes and Parfumo have none: they
are cited, and `readPerfumeLink` (`src/lib/catalogue/perfume-sources.ts`) reads
only their addresses. Every action returns `{ error }` instead of throwing when
Wikidata cannot be reached, so manual entry goes on.

- `searchPerfumeSource(text)`: Wikidata items that are perfumes (instance of
  Q131746), at most ten, and what Wikidata covers.
- `reviewPerfumeSource({ perfumeId | null, externalId })`: the item's title,
  description and launch date set against the perfume, each `fill`, `same`,
  `conflict` or `locked`; its brands, manufacturers and perfumers, matched to
  the library by Wikidata id, then by one exact name (two of a name match
  none). Reads only.
- `applyPerfumeSource({ perfumeId, fingerprint, externalId, fields,
  organizations, perfumers })`: fetches the item again, keeps it as an
  accepted source with its id (an id another perfume holds refuses the save),
  fills the chosen empty fields, and adds the chosen organizations and
  perfumers (created when missing, credited as attributed, with their
  Wikidata ids). Nothing on the perfume is replaced. A locked Wikidata source
  refuses the save.
- `recordPerfumeEntrySource({ perfumeId, link, retrievedOn })`: a new
  perfume's source: a Wikidata item as an accepted observation, any other
  link cited as the person's own source, without reading it.

## Film sources (`src/lib/actions/film-sources.ts`, SLN-376)

Wikidata is the one film source with a documented public API and no key
(`src/lib/providers/wikidata-films.ts`, through the provider contract; it
shares its Wikidata calls with the perfume provider in
`src/lib/providers/wikidata.ts`). TMDB needs a key, IMDb and Letterboxd have no
open API: `FILM_SOURCES` (`src/lib/catalogue/film-sources.ts`) says why each is
cited and not looked up. Every action returns `{ error }` instead of throwing
when Wikidata cannot be reached, so manual entry goes on.

- `searchFilmSource(text)`: up to ten Wikidata films (instances of a film
  class) by title, or the one a Wikidata id or link, an IMDb `tt` id or a TMDB
  movie link names; each with its year and director.
- `reviewFilmSource({ filmId | null, externalId })`: the film's title,
  original title, description, first release, countries and languages set
  against the film, each `fill`, `same`, `conflict`, `locked` or `unlisted`
  (none is in Durtal's list; countries, release places and languages are
  matched by ISO code, else by English name); the cast and crew (with
  characters, in billing order when Wikidata gives one) and production
  companies, matched by Wikidata id, then by one exact name; the IMDb, TMDB
  and Letterboxd ids (and another film holding one); the running time against
  the first version; each release with its place, country and format; the
  Commons poster with its terms; the first-release years here and on Wikidata
  (`differs` when more than a year apart); another film here holding this
  Wikidata film; and what changed since the last accepted answer. Reads only.
- `applyFilmSource({ filmId, fingerprint, externalId, sameFilm, fields,
  credits, organizations, identifiers, runtime, releases })`: checks the
  film's fingerprint, fetches the item again and keeps it as an accepted
  source. Fills the chosen empty fields, adds the chosen credits and companies
  (made when missing, credited as attributed, with their Wikidata ids),
  registers the chosen ids, and puts the running time and the chosen releases
  on the first version (made when the film has none), each citing the answer.
  Nothing on the film is replaced or removed. A locked Wikidata source,
  another film holding the item, or a different year without `sameFilm`
  refuses the save. The poster is saved by the page through
  `/api/media/from-url` with its Commons credit.

## Painting sources (`src/lib/actions/painting-sources.ts`, SLN-378)

Museums with documented open APIs and no key: the Art Institute of Chicago
(`artic`) and The Met (`metmuseum`), in `src/lib/providers/museums.ts`, through
the provider contract. `src/lib/catalogue/painting-sources.ts` lists the
museums considered and why the others are not looked up. Every action returns
`{ error }` instead of throwing when a museum cannot be reached.

- `searchPaintingSource({ museum, text })`: up to ten works of that museum.
- `reviewPaintingSource({ museum, paintingId, externalId, objectId? })`: the
  answer set against the painting (title, date, painter) and its original
  (accession number, owner, size), each `fill`, `same`, `conflict` or
  `locked`; the location evidence (`on_view`, `not_on_view`, `unknown`) with
  the day it was given and what saving would do (`record`, `verify`, `move` or
  nothing); the last answer of this museum, its age and what changed. Reads
  only.
- `applyPaintingSource(...)`: fetches the answer again and checks the
  painting's, the original's and the location history's fingerprints. Keeps
  the answer as an accepted source (the successor of the museum's previous
  answer, which stays). Fills the chosen empty fields, credits the painter as
  attributed, adds the original when asked (owned by the museum, which is
  created in Organizations when missing, with its Wikidata id). A location is
  written only from an "on view" answer, through `recordWhereabouts` or
  `updateWhereabouts`: a first record at the museum's venue, a check of the
  current one, or a move dated the day of the answer. A locked source stops
  the save.

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

## Edit dialog lists (`src/lib/actions/edit-options.ts`, SLN-510)

```typescript
getEditOptions(groups: EditOptionGroup[]): Promise<Partial<Record<EditOptionGroup, { id: string; name: string }[]>>>
```

The lists the book page's edit dialogs choose from, loaded when a dialog opens: `series`, `workTypes`, `recommenders`, `genres`, `tags`, `subjects`, `categories`, `themes`, `literaryMovements`, `artTypes`, `artMovements`, `keywords`, `attributes` (`EDIT_OPTION_GROUPS`, `src/lib/catalogue/edit-options.ts`). Only the groups asked for, each item as `{ id, name }` (a series' title is its name), in the order the dialogs show them. An empty list or an unknown group is refused before anything is read. Like every action, it runs behind the host's Authelia session, and Next.js checks that the call comes from the app's own origin.

---

## Media (`src/lib/actions/media.ts`)

### `getMediaForWork(workId)`

```typescript
getMediaForWork(workId: string): Promise<Media[]>
```

Returns all media ordered by `sortOrder`.

### `getMediaByType(ownerId, type, ownerType?)`

```typescript
getMediaByType(ownerId: string, type: string, ownerType?: MediaOwnerType): Promise<Media[]>
```

One owner's images of one type (`poster`, `background`, `gallery`), the active one first, then by `sortOrder`, newest first. `ownerType` defaults to `"work"`; an unknown owner is refused. The media manager (`src/components/media/media-manager-dialog.tsx`) loads each tab with it, for every kind of owner.

### `createMedia(input)`

```typescript
createMedia(input: CreateMediaInput): Promise<Media>
```

Validates that exactly one of `workId` or `authorId` is set (XOR). Validated against `createMediaSchema`.

### `deleteMedia(id)` / `bulkDeleteMedia(ids)`

Deletes the media records first, then their S3 objects (full image, thumbnail and original). A file that another row still stores is kept. `deleteMedia` makes the next image of the same type active when it deletes the active one.

### Shared image presentation (`src/lib/actions/image-adjustments.ts`)

`getImagePresentation(source)` resolves an existing registered S3 image and returns neutral/previous settings, `revision`, `supportsCrop`, policy-derived `fit` and `aspect`, and the current `display` source separately from the editor-base `preview`. `appliedCrop` identifies a retained baked crop; `crop` contains editable unrotated coordinates only when the owner policy supports cropping. Non-media registered images remain contained with no crop controls. E-book cover routes, remote URLs, non-image attachments and author color originals remain unsupported.

`saveImagePresentation(source, { settings, revision, crop? })` requires the opaque revision loaded with the editor. It checks the actual owner policy again and rejects unsupported crop input. Precise SQL revision comparisons and missing-adjustment identity locks run inside the same transaction as settings/media writes. Stale edits return `{ error: "stale", message }` with a fixed reload/review message that survives production server-error redaction, without overwriting the competing save; crop derivatives created for a rejected write are cleaned. Other errors are thrown without exposing SQL/parameters in the result. Successful saves return the committed source aliases, settings, monochrome policy and next `revision`; consumers must handle the stale branch and retain that next revision for another Save. There is no migration or rotation renderer in this foundation contract.

Canonical full/thumbnail selection skips null and empty keys consistently in both resolution and SQL fingerprints. A valid-revision Save whose former display alias has disappeared after cropping/reprocessing returns the same stale result without writing. This handling is limited to exhausted source lookup; validation and database failures still throw, and known original-image/non-image attachment sources remain unsupported. A missing source on Read still reports that the image was not found.

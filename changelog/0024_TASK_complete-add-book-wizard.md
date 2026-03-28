# Task 0024: Complete the Add Book Wizard (Steps 2-6)

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

The add-book wizard at `/library/new` (`src/app/library/new/wizard.tsx`) currently implements only 3 of 6 spec-defined steps: Search, Work Details, and Edition Details. It creates a work + edition but **never creates an instance**, meaning every book added has zero location assignments and shows "No copies recorded" on the detail page. This task completes the wizard to full spec compliance.

### Current state (broken flow)

```
Step 1: Search/Identify        ← IMPLEMENTED (wizard.tsx lines 152-236)
Step 2: Work Confirmation      ← MISSING (no duplicate detection)
Step 3: Edition Metadata       ← IMPLEMENTED (wizard.tsx lines 331-423)
Step 4: Instance Creation      ← MISSING (no location/format/condition UI)
Step 5: Categorization         ← MISSING (no genres/tags/subjects/collections)
Step 6: Confirm                ← MISSING (no summary, submit happens on Step 3)
```

### Target state

All 6 steps implemented. A book added through the wizard has: work + author, edition + cover, at least one instance with location, and optional categorization. The "Add to catalogue" action only fires from the final confirmation step.

---

## Implementation Plan

### Phase 1 — Step 2: Work Duplicate Detection

The wizard currently skips straight from search results to the work details form. If the user picks a result that matches an existing work (same ISBN or close title+author), they should be prompted: "Add a new edition to existing work [title]?" or "Create as new work?"

- [x] **1.1** Create server action `findDuplicateWork` in `src/lib/actions/works.ts`
  - Input: `{ isbn13?: string; title: string; authorName: string }`
  - Logic: first try exact ISBN match against `editions.isbn13`. If no ISBN or no match, try fuzzy match: `ilike(works.title, title)` joined with `workAuthors → authors` where `ilike(authors.name, authorName)`. Return the matching work with its editions, or null.
  - Returns: `WorkWithRelations | null`
- [x] **1.2** Add a `"duplicate"` value to the `Step` type union in `wizard.tsx`
- [x] **1.3** Build the duplicate detection UI between the search step and the details step
  - After user selects a search result (or enters manual details and clicks Next), call `findDuplicateWork` with the ISBN and title+author
  - If a match is found, render a card showing the existing work (title, author, year, edition count, instance count) with two buttons:
    - "Add edition to this work" → skip work creation, go to edition step with `existingWorkId` set
    - "Create as new work" → proceed to details step as normal
  - If no match found, proceed to details step automatically (no interruption)
- [x] **1.4** Thread `existingWorkId` through the wizard state. When set, the details step is skipped (work already exists), and `handleSubmit` uses the existing work ID instead of calling `createWork`

### Phase 2 — Step 4: Instance Creation

This is the critical missing step. After edition details, the user must assign the book to at least one location.

- [x] **2.1** Add `"instance"` to the `Step` type union in `wizard.tsx`
- [x] **2.2** Add wizard state for instances — an array of instance drafts:
  ```typescript
  interface InstanceDraft {
    locationId: string;
    subLocationId?: string;
    format: string;
    condition: string;
    // Acquisition
    acquisitionType: string;
    acquisitionDate: string;
    acquisitionSource: string;
    acquisitionPrice: string;
    acquisitionCurrency: string;
    // Collector
    isSigned: boolean;
    signedBy: string;
    inscription: string;
    isFirstPrinting: boolean;
    provenance: string;
    // Condition details
    hasDustJacket: boolean | null;
    hasSlipcase: boolean | null;
    conditionNotes: string;
    // Digital
    calibreId: string;
    calibreUrl: string;
    fileSizeBytes: string;
    // Personal
    notes: string;
  }
  ```
  Initialize with one empty draft. User can add more via "Add another copy" button.
- [x] **2.3** Create `src/components/books/instance-form.tsx` — a self-contained form for a single instance draft. Fields organized in collapsible sections:
  - **Location** (always visible, required):
    - Location dropdown — fetched via `getLocations()` server action. Shows location name + type badge. Required field.
    - Sub-location dropdown — populated from the selected location's `subLocations`. Optional.
  - **Format & Condition** (always visible):
    - Format: Select with options from `INSTANCE_FORMATS` in `src/lib/types/index.ts`: hardcover, paperback, ebook, audiobook, pdf, epub, other
    - Condition: Select with options from `INSTANCE_CONDITIONS`: mint, fine, very_good, good, fair, poor
    - Has dust jacket: checkbox (physical formats only)
    - Has slipcase: checkbox (physical formats only)
    - Condition notes: textarea
  - **Acquisition** (collapsible, default closed):
    - Type: Select from `ACQUISITION_TYPES`: purchased, gift, inherited, borrowed, found, review_copy, other
    - Date: date input
    - Source: text input (e.g., "Amazon", "Waterstones Amsterdam", "Estate sale")
    - Price: number input
    - Currency: text input (3 chars, e.g., "EUR", "USD", "MXN")
  - **Collector Details** (collapsible, default closed):
    - Is signed: checkbox
    - Signed by: text input (shown when isSigned is true)
    - Inscription: textarea (shown when isSigned is true)
    - Is first printing: checkbox
    - Provenance: textarea
  - **Digital Details** (collapsible, shown only when format is ebook/pdf/epub/audiobook):
    - Calibre ID: number input
    - Calibre URL: text input
    - File size (bytes): number input
  - **Notes** (collapsible, default closed):
    - Free-text textarea
- [x] **2.4** Build the instance step in `wizard.tsx`:
  - Renders one `InstanceForm` per draft in the instances array
  - "Add another copy" button appends a new empty draft
  - "Remove" button on each instance (except the first — at least one required)
  - Navigation: Back (to edition step) / Next (to categorization step)
  - Validation: at least one instance with a `locationId` selected
- [x] **2.5** Wire up `createInstance` call in `handleSubmit` — after creating the edition, iterate over the instances array and call `createInstance` for each draft with the newly created `edition.id`

### Phase 3 — Step 5: Categorization

Optional step for assigning subjects, genres, tags, and collections. All data is fetched from existing server actions.

- [x] **3.1** Add `"categorize"` to the `Step` type union in `wizard.tsx`
- [x] **3.2** Add wizard state for categorization:
  ```typescript
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [selectedGenreIds, setSelectedGenreIds] = useState<string[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  ```
- [x] **3.3** Create `src/components/books/categorization-form.tsx` — four sections, each a multi-select from existing database records:
  - **Subjects** (work-level): Fetch via `getSubjects()`. Display as a searchable checkbox list. Selected subjects are shown as badges.
  - **Genres** (edition-level): Fetch via `getGenres()`. Display hierarchically (parent → children). Selected genres shown as badges.
  - **Tags** (edition-level): Fetch via `getTags()`. Display as a searchable checkbox list. Selected tags shown as badges.
  - **Collections** (edition-level): Fetch via `getCollections()`. Display as a checkbox list. Selected collections shown as badges.
  - Each section: text filter input at the top, scrollable list (max-height ~200px), selected count badge
- [x] **3.4** Build the categorization step in `wizard.tsx`:
  - Renders `CategorizationForm` with the four state arrays
  - "Skip" link visible (this step is optional)
  - Navigation: Back (to instance step) / Next (to confirm step)
- [x] **3.5** Wire up categorization in `handleSubmit`:
  - Pass `subjectIds` to `createWork()` (already supported in the schema)
  - Pass `genreIds` and `tagIds` to `createEdition()` (already supported in the schema)
  - After edition creation, call `addEditionToCollection()` for each selected collection

### Phase 4 — Step 6: Confirmation Summary

Final review step before committing. No data is created until the user clicks "Add to catalogue" here.

- [x] **4.1** Add `"confirm"` step rendering to `wizard.tsx` (the type already exists but has no UI)
- [x] **4.2** Build the confirmation summary UI:
  - **Work section**: Title, author(s), original year, original language, series (if any), description (truncated)
  - **Edition section**: ISBN, publisher, publication year, language, page count, binding, cover thumbnail (if coverUrl is set, show `<img>` preview)
  - **Instance(s) section**: For each instance — location name, format badge, condition badge, acquisition type, price/currency (if set), collector flags (signed, first printing)
  - **Categorization section** (if anything selected): Subjects as badges, genres as badges, tags as badges, collections as badges
  - Visual style: read-only card layout using existing `Card` / `CardContent` / `Badge` components. Dense, scannable.
- [x] **4.3** Move `handleSubmit` to only be callable from the confirm step. The "Add to catalogue" button with the `<Plus>` icon should only appear here.
- [x] **4.4** Add an "Edit" link/button next to each section header that jumps back to the relevant step (e.g., clicking "Edit" on the instance section goes back to `"instance"` step) so the user can correct anything before confirming

### Phase 5 — Fix Existing Bugs in Steps 1-3

- [x] **5.1** Fix ISBN validation: `createEditionSchema` (line 9 of `src/lib/validations/editions.ts`) requires exactly 13 consecutive digits (`/^\d{13}$/`). The wizard's search handler strips hyphens for the API call (line 71 of `wizard.tsx`) but the ISBN state retains the raw format. Strip hyphens from `isbn13` before passing to `createEdition()` in `handleSubmit`.
- [x] **5.2** Fix duplicate author creation: `createAuthor` in `wizard.tsx` line 108 creates a new author every time, even if one with the same name already exists. Add a `findOrCreateAuthor` action in `src/lib/actions/authors.ts` that checks for an existing author by name (case-insensitive) before creating. Use this in the wizard.
- [x] **5.3** Fix the language selector: Both the work details step (line 272-289) and edition step (line 364-373) hardcode a short list of languages. Extract a shared `LANGUAGES` constant in `src/lib/constants/languages.ts` with at least 30 languages (all ISO 639-1 codes commonly encountered in book cataloguing). Import and use in both selectors.

### Phase 6 — Update handleSubmit for Full Flow

The current `handleSubmit` (wizard.tsx lines 99-147) only creates author + work + edition. It needs to be rewritten to handle the complete flow.

- [x] **6.1** Rewrite `handleSubmit` in `wizard.tsx` with the following ordered operations:
  1. Find or create author (using `findOrCreateAuthor` from Phase 5.2)
  2. Create work (or use `existingWorkId` from Phase 1) — pass `subjectIds`
  3. Create edition — pass `genreIds`, `tagIds`, `coverSourceUrl`
  4. Create all instances — iterate `instanceDrafts`, call `createInstance` for each with `edition.id`
  5. Add edition to collections — iterate `selectedCollectionIds`, call `addEditionToCollection` for each
  6. Redirect to `/library/{work.id}`
- [x] **6.2** Add error handling per step: if instance creation fails for one instance, still create the others. Show a toast per failure. If the work or edition creation fails, abort entirely and show an error.
- [x] **6.3** Add loading state: show a progress indicator during submission ("Creating work...", "Uploading cover...", "Creating instances...") since cover processing can take a few seconds

### Phase 7 — Step Navigation and Progress Indicator

- [x] **7.1** Add a step progress bar at the top of the wizard showing all 6 steps with the current step highlighted. Use a horizontal bar with step labels:
  ```
  Search → Details → Edition → Instance → Categorize → Confirm
  ```
  - Completed steps: `text-fg-primary` with a checkmark
  - Current step: `text-accent-rose` with active indicator
  - Future steps: `text-fg-muted`
  - Clicking a completed step navigates back to it
- [x] **7.2** Update the step flow to match the full sequence:
  ```
  "search" → "duplicate" (conditional) → "details" → "edition" → "instance" → "categorize" → "confirm"
  ```
  - `"duplicate"` is only shown when a potential duplicate is detected
  - When `existingWorkId` is set (reusing existing work), `"details"` is skipped
  - `"categorize"` has a "Skip" option that jumps to `"confirm"`

---

## Files Created

- `src/components/books/instance-form.tsx` — single instance draft form with collapsible sections
- `src/components/books/categorization-form.tsx` — multi-select for subjects, genres, tags, collections
- `src/lib/constants/languages.ts` — shared ISO 639-1 language list for selectors

## Files Modified

- `src/app/library/new/wizard.tsx` — complete rewrite: 6-step flow, new state, new handleSubmit
- `src/lib/actions/works.ts` — add `findDuplicateWork` action
- `src/lib/actions/authors.ts` — add `findOrCreateAuthor` action
- `src/lib/validations/editions.ts` — no code change needed, but ISBN stripping happens in wizard before passing

## Existing Backend (No Changes Needed)

These server actions and schemas already exist and support the full feature set:

| Action | File | What it does |
|--------|------|-------------|
| `createWork` | `src/lib/actions/works.ts:112` | Creates work + links authors + links subjects |
| `createEdition` | `src/lib/actions/editions.ts:42` | Creates edition + processes cover via S3 + links contributors, genres, tags |
| `createInstance` | `src/lib/actions/instances.ts:11` | Creates instance with location, format, condition, acquisition, collector, digital fields |
| `getLocations` | `src/lib/actions/locations.ts:7` | Fetches all locations with sub-locations (for instance form dropdown) |
| `getSubjects` | `src/lib/actions/taxonomy.ts:9` | Fetches all subjects (for categorization) |
| `getGenres` | `src/lib/actions/taxonomy.ts:27` | Fetches all genres with parent/child hierarchy |
| `getTags` | `src/lib/actions/taxonomy.ts:67` | Fetches all tags |
| `getCollections` | `src/lib/actions/collections.ts:7` | Fetches all collections |
| `addEditionToCollection` | `src/lib/actions/collections.ts:79` | Links edition to collection |
| `processAndUploadCover` | `src/lib/s3/covers.ts:71` | Downloads cover URL → sharp resize → S3 gold/ → returns keys |

## Validation Schemas (Already Complete)

| Schema | File | Fields |
|--------|------|--------|
| `createWorkSchema` | `src/lib/validations/works.ts` | title, originalLanguage, originalYear, description, seriesName, seriesPosition, isAnthology, notes, rating, catalogueStatus, authorIds[], subjectIds[] |
| `createEditionSchema` | `src/lib/validations/editions.ts` | workId, title, subtitle, isbn13, isbn10, asin, lccn, oclc, openLibraryKey, googleBooksId, goodreadsId, publisher, imprint, publicationDate, publicationYear, publicationCountry, editionName, editionNumber, printingNumber, isFirstEdition, isLimitedEdition, limitedEditionCount, language, isTranslated, pageCount, binding, heightMm, widthMm, depthMm, weightGrams, illustrationType, description, tableOfContents, coverSourceUrl, metadataSource, metadataLocked, notes, contributorIds[], genreIds[], tagIds[] |
| `createInstanceSchema` | `src/lib/validations/instances.ts` | editionId, locationId, subLocationId, format, condition, hasDustJacket, hasSlipcase, conditionNotes, isSigned, signedBy, inscription, isFirstPrinting, provenance, acquisitionType, acquisitionDate, acquisitionSource, acquisitionPrice, acquisitionCurrency, calibreId, calibreUrl, fileSizeBytes, notes, isLentOut, lentTo, lentDate |

## UI Components Available

| Component | File | Usage |
|-----------|------|-------|
| `Input` | `src/components/ui/input.tsx` | Text/number inputs with label + error |
| `Textarea` | `src/components/ui/textarea.tsx` | Multi-line text with label + error |
| `Select` | `src/components/ui/select.tsx` | Dropdown with label + error + placeholder |
| `Button` | `src/components/ui/button.tsx` | Variants: primary, secondary, ghost, danger. Sizes: sm, md, lg |
| `Card` / `CardContent` / `CardHeader` | `src/components/ui/card.tsx` | Content containers |
| `Badge` | `src/components/ui/badge.tsx` | Status/label badges (muted, sage, blue, gold, red, default) |
| `Dialog` | `src/components/ui/dialog.tsx` | Modal dialog |
| `Spinner` | `src/components/ui/spinner.tsx` | Loading spinner |

## Design Constraints

- Dark-mode only. Gothic-minimal aesthetic per `docs/03_DESIGN_LANGUAGE.md`
- Border radius: 2px (`rounded-sm`)
- Colors: desaturated, muted. Use existing CSS variables.
- Typography: serif headings (EB Garamond via `font-serif`), sans body (Inter)
- Icons: Lucide, 1.5px stroke, 16px max
- Collapsible sections: use `<details>` / `<summary>` or a simple toggle with chevron icon
- All form fields use existing `Input`, `Select`, `Textarea` components for consistency
- Max width of wizard: `max-w-2xl` (already set in wizard.tsx line 150)

## Success Criteria

1. User can add a book via ISBN search → full flow → book appears in library with instance(s)
2. User can add a book manually → full flow → book appears with location assignment
3. Duplicate detection prevents creating the same work twice
4. At least one instance (location) is required before confirmation
5. Categorization step is skippable but functional when used
6. Confirmation step shows complete summary before committing
7. Cover image is processed and visible on the detail page
8. `pnpm typecheck` passes
9. `pnpm build` succeeds

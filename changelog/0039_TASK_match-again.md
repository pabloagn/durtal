# Task 0039: Match Again (Re-Match Incorrectly Matched Books)

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0036
**Blocks**: None

## Overview

When a book is added via the wizard, it is matched against external APIs (Google Books, Open Library) to pull metadata. Sometimes the match is wrong -- the user gets a different edition, a different book entirely, or a poor-quality match. "Match again" allows the user to re-run the matching process and pick a better result, or search manually for the correct match.

Accessible from:
1. The book card actions menu in the library view (Task 0036)
2. The book detail page (as an action button)

## Implementation Details

### 1. Match Again Dialog

**New file: `src/components/books/match-again-dialog.tsx`**

`"use client"` component:

```typescript
interface MatchAgainDialogProps {
  open: boolean;
  onClose: () => void;
  workId: string;
  currentTitle: string;
  currentAuthor: string;
  currentIsbn?: string;          // from primary edition if available
  currentMetadataSource?: string; // "google_books" | "open_library" | null
  currentMetadataSourceId?: string;
}
```

Dialog layout:

**Header area:**
- Title: "Match again"
- Subtitle: "Current match: {title} by {author}" with source badge (Google Books / Open Library / Manual)

**Search area:**
- Pre-filled search input with current title + author
- Source selector: "All", "Google Books", "Open Library"
- "Search" button
- User can modify the search query to find the right book

**Results area:**
- List of search results from selected API(s)
- Each result shows: title, author(s), year, ISBN, cover thumbnail, source badge
- Current match highlighted (if it appears in results)
- "Select" button on each result
- "No match -- keep current" option at the bottom

**On select:**
- Confirmation: "Replace metadata from {source}? This will update the edition's title, ISBN, publisher, cover, and other metadata fields. Your manual edits to the work (title, authors, rating, status) will NOT be changed."
- On confirm: call a server action to re-import metadata for the primary edition
- Toast success, `router.refresh()`, close dialog

### 2. Re-Match Server Action

**File: `src/lib/actions/editions.ts`**

New action: `rematchEdition(editionId: string, source: string, sourceId: string)`

Steps:
1. Fetch full metadata from the specified source API (Google Books or Open Library)
2. Update the edition record with new metadata fields:
   - Title, subtitle, publisher, publication year/date, page count, language, binding
   - ISBN-13, ISBN-10 (if available)
   - Source-specific IDs (googleBooksId, openLibraryKey)
   - Description
3. If a new cover URL is found, re-process the cover (download, upload to S3, generate thumbnail)
4. Update `metadataSource` and `metadataLastFetched`
5. Do NOT modify: the parent work's title, authors, rating, catalogue status, or any taxonomy
6. Return the updated edition

### 3. Search API Integration

The matching search should reuse existing API clients:
- `src/lib/api/google-books.ts` -- `searchGoogleBooks(query)`
- `src/lib/api/open-library.ts` -- `searchOpenLibrary(query)`

The dialog needs a client-side search endpoint or can call these directly via a new API route:

**New file: `src/app/api/match/route.ts`**

```typescript
GET /api/match?q=<query>&source=<all|google_books|open_library>
```

Returns normalized results from one or both sources, deduplicated by ISBN where possible.

### 4. Entry Points

**Library view (card actions menu):**
- "Match again" menu item opens `MatchAgainDialog`
- Need to pass primary edition info (ISBN, metadata source) -- may need to fetch this when menu is opened, or include it in the BookCard props pipeline

**Book detail page:**
- Add a `RefreshCw` icon button next to the edition metadata source info
- Or add it as an action in the edition card header
- Opens same `MatchAgainDialog`

### 5. Metadata Source Display

On the book detail page, show the current metadata source clearly:
- Badge on the edition card: "Google Books", "Open Library", or "Manual"
- Last fetched date
- "Match again" action next to it

### Files

| File | Change |
|---|---|
| `src/components/books/match-again-dialog.tsx` | New: re-matching dialog with search, results, and selection |
| `src/app/api/match/route.ts` | New: API route for searching external book APIs |
| `src/lib/actions/editions.ts` | Add `rematchEdition` server action |
| `src/components/books/book-card-actions-menu.tsx` | Wire "Match again" menu item |
| `src/app/library/[slug]/edition-detail-card.tsx` | Add match-again button to edition card |

## Completion Notes

Implemented the full "Match again" feature across 6 files:

1. **API route** (`src/app/api/match/route.ts`): GET endpoint accepting `?q=` and `?source=` params. Queries Google Books and/or Open Library, returns normalized results.

2. **Server actions** (`src/lib/actions/editions.ts`): Added `getPrimaryEdition(workId)` to resolve the primary edition for a work, and `rematchEdition(editionId, source, sourceId)` which fetches full metadata from the selected source API (Google Books volume endpoint or Open Library work/edition endpoint), updates edition fields (title, subtitle, publisher, year, page count, language, ISBNs, description, source IDs), re-processes cover images via S3, and sets `metadataSource`/`metadataLastFetched`. Does not touch parent work metadata.

3. **Match Again Dialog** (`src/components/books/match-again-dialog.tsx`): Client component with search input (pre-filled with current title + author), source filter (All / Google Books / Open Library), scrollable results list with cover thumbnails and source badges, and a confirmation step before applying the rematch.

4. **Book card actions menu** (`src/components/books/book-card-actions-menu.tsx`): Enabled the previously disabled "Match again" menu item. Added `authorName` prop for search pre-fill. Opens MatchAgainDialog on click.

5. **Book card** (`src/components/books/book-card.tsx`): Passes `authorName` to BookCardActionsMenu.

6. **Edition detail card** (`src/app/library/[slug]/edition-detail-card.tsx`): Added RefreshCw icon button in the edition card header action buttons, rendered via `EditionMatchButton` client component (`src/app/library/[slug]/edition-match-button.tsx`). Opens MatchAgainDialog targeting the specific edition.

7. **Detail page** (`src/app/library/[slug]/page.tsx`): Passes `workId` and `authorName` to EditionDetailCard.

TypeScript typecheck passes cleanly.

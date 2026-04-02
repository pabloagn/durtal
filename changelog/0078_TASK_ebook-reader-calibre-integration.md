# Task 0078: In-App Ebook Reader with Calibre Library Integration

**Status**: Completed
**Created**: 2026-03-31
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

Build a full-featured EPUB/PDF reader into Durtal, replacing the Calibre-Web reading experience. The reader accesses ebook files stored in the Calibre library at `/mnt/data/Books-Library/` and renders them with a gothic-minimal dark UI that matches Durtal's design language.

Two entry points:
1. A **"Read" button** on book detail pages for works that have a matched digital edition in Calibre.
2. A **"Reader" tab** in the main sidebar that browses ALL digital books in the Calibre library (including those not curated in Durtal).

---

## Architecture Decisions

### Calibre Data Access: Sync Script (Not Runtime SQLite)

**Decision**: A Python sync script reads Calibre's `metadata.db` (SQLite) and upserts into a new `calibre_books` table in Neon Postgres. The Next.js app never touches SQLite at runtime.

**Why**: Keeps the Docker image clean (no `better-sqlite3` native bindings), decouples Calibre access from request handling, and follows the existing `scripts/ingest/` pattern. The Calibre library changes infrequently (manual additions), so a manual re-run or daily cron is sufficient.

**Alternative rejected**: Direct runtime SQLite reads via `better-sqlite3`. While sub-millisecond and always fresh, it adds a native dependency to the Docker build (requires `python3 make g++` in Alpine), introduces a second database connection pattern alongside Drizzle/Neon, and complicates serverless deployment if ever needed.

### EPUB Rendering: epub.js with Custom React Wrapper

**Decision**: Use `epubjs` (npm) directly with a purpose-built React wrapper. Do NOT use `react-reader` (the popular wrapper).

**Why**: epub.js is the only library with mature EPUB CFI support, proven browser compatibility, and documented edge cases (20K weekly npm downloads). Despite being effectively unmaintained since mid-2024, EPUB is a stable specification -- the rendering engine doesn't need frequent updates.

**Why not react-reader**: It adds its own opinions about UI (white theme, specific controls layout) that conflict with Durtal's dark gothic-minimal aesthetic. A custom wrapper gives full control over styling.

**Why not Readium ts-toolkit**: Most technically capable (first-class TypeScript, foundation-backed, best theming via Readium CSS), but integration complexity is high and React patterns are poorly documented. Revisit when Thorium Web's patterns are more established.

**Why not foliate-js**: Author explicitly warns "the library itself is not stable and you should expect it to break and the API to change at any time." No npm package, no TypeScript support.

### Routing: Route Groups for Layout Bypass

**Decision**: Use Next.js App Router route groups to give the reader a full-viewport layout without the Shell sidebar.

```
src/app/
  (main)/             -- Route group with Shell layout (sidebar, constrained content)
    layout.tsx
    library/
    authors/
    reader/            -- Reader library browse page (has sidebar)
      page.tsx
  (reader)/            -- Route group with bare layout (full viewport, no sidebar)
    layout.tsx
    reader/
      [calibreId]/     -- Active reading view (immersive, no sidebar)
        page.tsx
```

Both route groups share the root `layout.tsx` (fonts, metadata, globals.css). The `(main)` group wraps children in `<Shell>`, the `(reader)` group does not.

**Why**: Reading is immersive -- the sidebar and page chrome are distractions. A dedicated route means the reader can be bookmarked, deep-linked, and navigated to directly. Keyboard bindings (arrow keys for pagination) won't conflict with Shell bindings.

### Book Matching: ISBN Auto-Suggest + Manual Linking

**Decision**: Three-tier matching during sync:
1. **ISBN match** (automatic): Compare Calibre's `identifiers` table (type='isbn') against `editions.isbn13/isbn10`. High confidence.
2. **Title + author fuzzy match** (suggested, requires confirmation): Normalized case-insensitive comparison of title and `author_sort`. Used when ISBNs are missing.
3. **Manual linking** (always available): UI to search Calibre books and link to a Durtal work.

Matched books get `calibre_books.work_id` set. Unmatched books still appear in the Reader library.

### File Serving: Direct Filesystem via API Route

**Decision**: A Next.js API route streams EPUB/PDF files directly from the Calibre library directory on disk. No S3 duplication for MVP.

```
GET /api/reader/[calibreId]/file?format=epub
  -> Resolves path from calibre_books.path
  -> Streams from /mnt/data/Books-Library/{path}/{name}.{format}
```

**Why**: The app runs on the same server as the Calibre library. Zero network latency, no storage duplication. Docker volume mount with `:ro` ensures Durtal can't modify the library.

**Security**: Path traversal prevention (resolve + startsWith check), read-only mount, known MIME types only, no directory listing. Authentication inherited from Authelia at the Traefik level.

### Progress Persistence: Database (Not localStorage)

**Decision**: Reading progress, bookmarks, and highlights are stored in Neon Postgres.

**Why**: The user may read on multiple devices (desktop, tablet). localStorage fragments reading state per device. The database is the single source of truth. Auto-save is debounced (3 seconds) to avoid excessive writes during rapid page-turning.

---

## Database Schema Changes

### New Table: `calibre_books`

Mirrors Calibre metadata for the reader library. Source of truth for ALL Calibre books, including those not in Durtal.

```typescript
// src/lib/db/schema/calibre-books.ts
export const calibreBooks = pgTable("calibre_books", {
  id: uuid("id").defaultRandom().primaryKey(),
  calibreId: integer("calibre_id").notNull().unique(),
  calibreUuid: text("calibre_uuid"),
  title: text("title").notNull(),
  authorSort: text("author_sort"),
  path: text("path").notNull(),             // Calibre relative path, e.g. "Agatha Christie/And Then There Were None (4707)"
  hasCover: boolean("has_cover").notNull().default(false),
  isbn: text("isbn"),
  formats: jsonb("formats").$type<{         // Array of available formats
    format: string;                          // "epub", "pdf", "mobi"
    fileName: string;                        // Filename without extension
    sizeBytes: number;
  }[]>(),
  pubdate: timestamp("pubdate", { withTimezone: true }),

  // Link to Durtal catalogue (nullable -- many Calibre books won't be in Durtal)
  workId: uuid("work_id").references(() => works.id, { onDelete: "set null" }),

  // Sync metadata
  lastSynced: timestamp("last_synced", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### New Table: `reading_progress` (Phase 2)

```typescript
// src/lib/db/schema/reading-progress.ts
export const readingProgress = pgTable("reading_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  calibreBookId: uuid("calibre_book_id")
    .notNull()
    .references(() => calibreBooks.id, { onDelete: "cascade" }),

  // Position tracking
  currentCfi: text("current_cfi"),           // EPUB CFI string
  currentPage: integer("current_page"),      // PDF page number
  progressPercent: real("progress_percent"), // 0.0 to 1.0
  currentChapter: text("current_chapter"),   // Human-readable chapter name

  // Reading stats
  totalReadingSeconds: integer("total_reading_seconds").default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### New Table: `reading_bookmarks` (Phase 3)

```typescript
export const readingBookmarks = pgTable("reading_bookmarks", {
  id: uuid("id").defaultRandom().primaryKey(),
  calibreBookId: uuid("calibre_book_id")
    .notNull()
    .references(() => calibreBooks.id, { onDelete: "cascade" }),
  cfi: text("cfi"),                          // EPUB CFI
  page: integer("page"),                     // PDF page
  label: text("label"),
  contextText: text("context_text"),         // Surrounding text snippet
  chapterTitle: text("chapter_title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### New Table: `reading_highlights` (Phase 3)

```typescript
export const readingHighlights = pgTable("reading_highlights", {
  id: uuid("id").defaultRandom().primaryKey(),
  calibreBookId: uuid("calibre_book_id")
    .notNull()
    .references(() => calibreBooks.id, { onDelete: "cascade" }),
  cfiRange: text("cfi_range").notNull(),     // EPUB CFI range
  selectedText: text("selected_text"),
  note: text("note"),
  color: text("color").notNull().default("rose"), // rose | gold | blue | sage
  chapterTitle: text("chapter_title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### Update `docs/02_DATA_MODEL.md`

Add the four new tables to the data model documentation.

---

## File Structure

### New Files

```
src/
  app/
    (main)/reader/
      page.tsx                              -- Reader library (browse all digital books, with sidebar)
    (reader)/reader/[calibreId]/
      page.tsx                              -- Active reading view (server: load metadata + progress)
      reader-client.tsx                     -- Client component: epub.js lifecycle (dynamic import, ssr:false)
      reader-toolbar.tsx                    -- Top bar: back button, title, TOC/settings toggles (auto-hides)
      reader-toc.tsx                        -- Table of contents panel (slides from left)
      reader-settings.tsx                   -- Settings panel (slides from right)
      reader-progress.tsx                   -- Bottom progress bar
    (reader)/
      layout.tsx                            -- Bare layout: fonts + globals, no Shell

  components/reader/
    epub-reader.tsx                          -- epub.js rendering component
    pdf-reader.tsx                           -- react-pdf rendering component (Phase 2)
    reader-library-grid.tsx                 -- Grid view for the reader library page
    reader-book-card.tsx                    -- Card for the reader library grid
    digital-edition-badge.tsx               -- Small badge for book cards showing "ebook available"
    read-button.tsx                         -- "Read" button/dropdown for book detail pages
    epub-theme.ts                           -- CSS generation for Durtal dark theme injection

  hooks/
    use-epub.ts                             -- Custom hook: epub.js lifecycle management
    use-reading-position.ts                 -- Custom hook: debounced position persistence
    use-reader-settings.ts                  -- Custom hook: font/theme/margin settings
    use-reader-gestures.ts                  -- Custom hook: keyboard + touch navigation

  lib/
    calibre/
      queries.ts                            -- Query functions for the calibre_books table
      match.ts                              -- Matching logic (ISBN + fuzzy title/author)
    actions/
      reader.ts                             -- Server actions: save/load progress, bookmarks
      calibre.ts                            -- Server actions: link/unlink calibre books to works
    db/schema/
      calibre-books.ts                      -- Drizzle schema for calibre_books
      reading-progress.ts                   -- Drizzle schema for reading_progress
      reading-bookmarks.ts                  -- Drizzle schema for reading_bookmarks (Phase 3)
      reading-highlights.ts                 -- Drizzle schema for reading_highlights (Phase 3)

  app/api/reader/
    [calibreId]/
      file/route.ts                         -- Stream book file from Calibre filesystem
      cover/route.ts                        -- Stream cover.jpg from Calibre filesystem
      progress/route.ts                     -- Save/load reading progress

scripts/
  calibre_sync/
    __init__.py
    main.py                                 -- Entry point: read metadata.db, upsert to Neon
    calibre_db.py                           -- SQLite reader for Calibre metadata.db
    matcher.py                              -- ISBN + fuzzy matching against Durtal editions
    config.py                               -- Env vars, paths
```

### Modified Files

```
src/app/(main)/layout.tsx                   -- Move Shell wrapper here (from root layout)
src/app/layout.tsx                          -- Keep only fonts, metadata, globals (shared by both route groups)
src/components/layout/sidebar.tsx           -- Add "Reader" nav item
src/components/layout/command-palette.tsx   -- Add "Reader" command
src/app/library/[slug]/page.tsx             -- Add ReadButton component to book detail header
src/components/books/book-card.tsx          -- Add DigitalEditionBadge
src/lib/db/schema/index.ts                 -- Export new schema tables
```

---

## Reader UI Design

### Reading View (Full Viewport)

```
+------------------------------------------------------------------+
|  [<-]  Book Title -- Chapter Name                  [TOC] [Cfg]   |  <- Top bar (auto-hides on inactivity)
|                                                                    |
|         +------------------------------------------+              |
|  [click |                                          | [click       |
|   zone: |     Book content (epub.js iframe)        |  zone:       |
|   prev  |                                          |  next        |
|   page] |     Dark background (#030507)            |  page]       |
|         |     Muted text (#c1c6c4)                 |              |
|         |     Serif headings (PPCirka/EB Garamond)  |              |
|         |     Sans body (Inter)                     |              |
|         |     Max-width: 680px (comfortable line    |              |
|         |     length, 60-75 chars)                  |              |
|         +------------------------------------------+              |
|                                                                    |
|  =============================                        Ch 3 / 24   |  <- Progress bar (auto-hides)
+------------------------------------------------------------------+
```

### Theme Injection (CSS injected into epub.js iframe)

```css
body {
  font-family: "Inter", system-ui, sans-serif !important;
  color: #c1c6c4 !important;
  background: #030507 !important;
  line-height: 1.8 !important;
}
h1, h2, h3, h4, h5, h6 {
  font-family: "PPCirka", "EB Garamond", Georgia, serif !important;
  color: #c1c6c4 !important;
}
a { color: #648493 !important; }
img { max-width: 100% !important; filter: brightness(0.85); }
::selection { background-color: #20131e !important; color: #c1c6c4 !important; }
```

### Configurable Reader Settings

| Setting        | Default    | Range                                          |
| -------------- | ---------- | ---------------------------------------------- |
| Font family    | Inter      | Inter, PPCirka (serif), System, Publisher default |
| Font size      | 18px       | 14px - 28px, 2px steps                         |
| Line height    | 1.8        | 1.4 - 2.4, 0.2 steps                          |
| Margins        | 12%        | 4% - 20%, 4% steps                             |
| Text alignment | Left       | Left, Justify                                   |

### Keyboard Navigation

| Key                | Action                 |
| ------------------ | ---------------------- |
| `ArrowRight/Space` | Next page              |
| `ArrowLeft`        | Previous page          |
| `t`                | Toggle TOC panel       |
| `s`                | Toggle settings panel  |
| `b`                | Toggle bookmark        |
| `Escape`           | Close panel / exit     |
| `f`                | Toggle fullscreen      |

### Click Zones

- Left 25% of viewport = previous page
- Right 25% = next page
- Center 50% = toggle chrome visibility (show/hide top bar + progress bar)

---

## API Routes

| Route                                | Method | Purpose                                                    |
| ------------------------------------ | ------ | ---------------------------------------------------------- |
| `/api/reader/[calibreId]/file`       | GET    | Stream EPUB/PDF from Calibre filesystem. `?format=epub`    |
| `/api/reader/[calibreId]/cover`      | GET    | Stream `cover.jpg` from Calibre book folder                |
| `/api/reader/[calibreId]/progress`   | GET    | Load reading progress (CFI, percentage, chapter)           |
| `/api/reader/[calibreId]/progress`   | POST   | Save reading progress (debounced from client)              |
| `/api/calibre/books`                 | GET    | List/search Calibre books. `?q=&limit=&offset=`           |
| `/api/calibre/books/[calibreId]`     | GET    | Single Calibre book metadata                               |
| `/api/calibre/match`                 | GET    | Find matching Calibre books. `?isbn=` or `?title=&author=` |
| `/api/calibre/stats`                 | GET    | Library stats (total books, formats, size)                 |

### File Serving Implementation Pattern

```typescript
// src/app/api/reader/[calibreId]/file/route.ts
// 1. Parse calibreId from params
// 2. Query calibre_books table for path + formats
// 3. Select preferred format (EPUB > PDF > MOBI) or honor ?format= param
// 4. Resolve full filesystem path: CALIBRE_LIBRARY_PATH / book.path / fileName.format
// 5. Path traversal check: resolved path must startsWith(CALIBRE_LIBRARY_PATH)
// 6. Stream with createReadStream -> Readable.toWeb()
// 7. Headers: Content-Type (application/epub+zip), Cache-Control (private, max-age=86400),
//    Content-Disposition (inline), Content-Length
```

### Format Priority

When a book has multiple formats, prefer: **EPUB > PDF > MOBI**. EPUB is the most web-friendly for in-browser rendering (reflowable, themeable). The `?format=` query param overrides this default.

---

## Calibre Sync Script

### Location

`scripts/calibre_sync/` following the existing `scripts/ingest/` pattern.

### Calibre metadata.db Key Tables

| Table                 | Key Columns                                           |
| --------------------- | ----------------------------------------------------- |
| `books`               | `id`, `title`, `sort`, `author_sort`, `path`, `has_cover`, `pubdate` |
| `data`                | `book` (FK), `format`, `name` (filename), `uncompressed_size` |
| `identifiers`         | `book` (FK), `type` ('isbn'), `val`                   |
| `authors`             | `id`, `name`, `sort`                                   |
| `books_authors_link`  | `book`, `author`                                       |

### File Path Resolution

A Calibre book file lives at:
```
{CALIBRE_LIBRARY_PATH}/{books.path}/{data.name}.{lower(data.format)}
```
Example: `/mnt/data/Books-Library/Agatha Christie/And Then There Were None (4707)/And Then There Were None - Agatha Christie.epub`

### Matching Algorithm (during sync)

1. Extract ISBNs from Calibre `identifiers` (type='isbn').
2. Query Durtal `editions` for matching `isbn13` or `isbn10`.
3. If matched: set `calibre_books.work_id` to the edition's `work_id`.
4. If no ISBN match: normalized case-insensitive title + author_sort comparison (Levenshtein distance < 3 for suggestions).
5. If no match: leave `work_id` null. Book appears in Reader library but has no catalogue link.

### Run Commands

```bash
uv run python -m scripts.calibre_sync.main --dry-run    # Preview
uv run python -m scripts.calibre_sync.main               # Full sync
```

Add to Taskfile:
```yaml
calibre:sync:
  cmds: [uv run python -m scripts.calibre_sync.main]
calibre:sync:dry:
  cmds: [uv run python -m scripts.calibre_sync.main --dry-run]
```

---

## Environment Configuration

```bash
# .env.local (add these)
CALIBRE_LIBRARY_PATH=/mnt/data/Books-Library
```

```yaml
# docker-compose.yml (add volume mount)
services:
  durtal:
    volumes:
      - /mnt/data/Books-Library:/mnt/data/Books-Library:ro
```

The `:ro` flag ensures Durtal cannot modify the Calibre library.

---

## NPM Dependencies

| Phase | Package       | Purpose                                      |
| ----- | ------------- | -------------------------------------------- |
| 1     | `epubjs`      | EPUB parsing, rendering, pagination, CFI     |
| 2     | `react-pdf`   | PDF rendering via pdf.js                     |
| 2     | `pdfjs-dist`  | Peer dependency of react-pdf                 |

No Python dependencies beyond the standard library (`sqlite3`, `psycopg2-binary` already in the project).

---

## Phased Implementation Plan

### Phase 1: MVP -- Read an EPUB from Calibre in Durtal

**Goal**: Click "Read" on a book detail page and read the EPUB in a beautiful dark reader.

1. [x] Create `calibre_books` Drizzle schema + migration
2. [x] Write Python sync script (`scripts/calibre_sync/`)
3. [ ] Run sync to populate `calibre_books` from Calibre `metadata.db` *(requires Calibre library access)*
4. [x] Create file-serving API route (`/api/reader/[calibreId]/file`) — async streaming, path traversal prevention, nosniff headers
5. [x] Create cover-serving API route (`/api/reader/[calibreId]/cover`) — async I/O, TOCTOU fix
6. [x] Shell-level layout bypass for reader view (deferred route groups; Shell.tsx regex detection hides sidebar for `/reader/{id}`)
7. [x] Install `epubjs`, build `EpubReader` client component with dark theme injection
8. [x] Create `/reader/[calibreId]/page.tsx` (server component: fetch metadata, render client reader)
9. [x] Create `/reader/page.tsx` (reader library: grid of all Calibre books with covers, search, format badges)
10. [x] Add "Reader" to sidebar and command palette
11. [x] Add `ReadButton` to book detail pages (for works with matched `calibre_books.work_id`)
12. [x] Add `DigitalEditionBadge` to book cards (badge + batch query for library grid)

### Phase 2: Reading Experience Polish

**Goal**: Sustained, comfortable reading sessions.

1. [x] Add `reading_progress` table + migration
2. [x] Auto-save reading position on page turn (debounced 3s, with beforeunload flush via sendBeacon)
3. [x] Restore position on reader load (`rendition.display(savedCfi)`)
4. [x] Table of contents sidebar (parsed from epub.js `book.navigation.toc`)
5. [x] Reader settings panel (font family, size, line height, margins, alignment)
6. [x] Keyboard navigation (arrows, space, t, s, f, Escape — bookmark `b` still pending)
7. [ ] Touch gesture support (swipe left/right for page turning)
8. [ ] PDF support with `react-pdf` (currently using iframe fallback)
9. [x] Progress bar with chapter indicator
10. [x] "Continue Reading" section on reader library page (recently opened books)
11. [ ] Generate epub.js locations in a Web Worker for accurate progress percentage; cache in database *(currently runs on main thread)*

### Phase 3: Full Feature Set

**Goal**: Feature parity with a dedicated ebook reader.

1. Add `reading_bookmarks` + `reading_highlights` tables + migration
2. Bookmarks: save CFI + label + surrounding text, gold bookmark indicator on page
3. Highlights: text selection triggers highlight toolbar (4 muted colors), stored as CFI ranges
4. Annotations: attach notes to highlights
5. Search within book (epub.js `book.search(query)`)
6. Manual matching UI: link unmatched Calibre books to Durtal works from reader library
7. Reading statistics (total reading time, books finished)
8. Auto-sync: daily cron or settings-page button to re-run Calibre sync
9. MOBI/AZW3 support via server-side conversion (Calibre `ebook-convert` CLI)

### Dependency Graph

```
Phase 1 (MVP)
  |
  +---> Phase 2 (Reading polish)
          |
          +---> Phase 3 (Full features)
```

Each phase builds on the previous. Phase 1 items are sequential (schema before sync, sync before API, API before reader). Phases 2 and 3 items are individually deployable within their phase.

---

## Performance Considerations

1. **Do NOT call `book.locations.generate()` eagerly.** This parses the entire book synchronously and can take 5-10 seconds. Instead, show chapter-based progress immediately and generate locations in a Web Worker in the background. Cache the generated locations in the database.

2. **Use the default (non-continuous) epub.js manager.** Renders only the current spread. The continuous manager has known memory leak issues.

3. **Pre-fetch adjacent chapters.** After rendering the current section, call `book.spine.get(currentIndex +/- 1)` to trigger background loading.

4. **Blob URL cleanup.** epub.js creates blob URLs for each resource. On chapter navigation, revoke blob URLs from distant chapters to prevent memory accumulation.

5. **File streaming.** EPUB files can be 1-50MB. The API route uses `createReadStream` + `Readable.toWeb()` to stream without loading the entire file into memory.

6. **Cache headers.** `Cache-Control: private, max-age=86400` on book files (content doesn't change). `private, max-age=604800` on covers (7 days).

---

## Implementation Notes (2026-04-01)

### Code Audit Findings (Fixed)

1. **hideTimeoutRef bug** (`reader-toolbar.tsx`): Was a plain object recreated every render instead of `useRef`. Fixed — timeouts now clear properly, no more flickering.
2. **Progress POST validation** (`progress/route.ts`): No input validation on `req.json()`. Fixed — added JSON parse try/catch, type coercion, string length limits.
3. **Debounce cleanup** (`reader-view.tsx`): Pending save timeouts were orphaned on unmount, losing the last reading position. Fixed — added `beforeunload` handler with `sendBeacon` and cleanup effect.
4. **Upsert race condition** (`queries.ts`): SELECT-then-INSERT was not atomic. Fixed — now uses `onConflictDoUpdate` on the unique `calibreBookId` constraint.
5. **Sync file I/O** (`file/route.ts`, `cover/route.ts`): `statSync`/`readFileSync`/`existsSync` blocked the event loop. Fixed — migrated to `fs/promises`. Cover route also fixed TOCTOU race (`existsSync` + `readFileSync` → single `readFile` in try/catch).
6. **Security headers**: Added `X-Content-Type-Options: nosniff` to both file and cover routes.
7. **Dead code**: Removed unused `getReadableBooks` function from `queries.ts`.

### Architecture Decision: Route Groups Deferred

Spec called for `(main)` and `(reader)` route groups. Deferred in favor of the Shell.tsx regex approach (`/reader/\d+` → full viewport, no sidebar). Rationale: route groups require moving every page file into `(main)/`, creating a massive diff with high breakage risk. The current approach achieves identical UX. Route groups can be adopted later as a standalone refactor.

### New Components Added

- `ReadButton` (`src/components/reader/read-button.tsx`): Shown on book detail pages for works with matched Calibre books. Prefers EPUB format. Displays available format labels.
- `DigitalEditionBadge` (`src/components/reader/digital-edition-badge.tsx`): Small BookOpen icon overlaid bottom-left on book cards (grouped with priority dot). Batch query (`getWorkIdsWithDigitalEditions`) avoids N+1.
- `getCalibreBooksByWorkId` / `getWorkIdsWithDigitalEditions` added to `src/lib/calibre/queries.ts`.

### Architecture Decision: S3 for Ebook Files (replacing filesystem)

The original spec assumed the Next.js app co-locates with the Calibre library (`/mnt/data/Books-Library/`). In practice, the Calibre library lives on a remote server, and Durtal runs on a different machine (local dev laptop, potential cloud deployment). Filesystem access is not viable.

**New approach**: Ebook files and covers are stored in S3, matching Durtal's existing media pipeline.

- **S3 key convention**: `gold/calibre/{calibreId}/{fileName}.{format}` for books, `gold/calibre/{calibreId}/cover.jpg` for covers
- **Schema changes**: Added `cover_s3_key` column to `calibre_books`. Added `s3Key` field to each entry in the `formats` JSONB. Migration: `0017_romantic_slipstream.sql`.
- **Sync script** (`scripts/calibre_sync/main.py`): Rewritten to upload files to S3 (via `boto3`) in addition to upserting metadata to Neon. Runs on the Calibre server (the machine with filesystem access). Supports `--dry-run`, `--force` (re-upload), `--skip-upload` (metadata-only).
- **API routes**: `/api/reader/[calibreId]/file` and `/api/reader/[calibreId]/cover` now redirect to presigned S3 URLs instead of streaming from filesystem. Follows the same pattern as `/api/s3/read`.
- **Additional audit fix**: `upsertReadingProgress` now builds the update set conditionally (only defined fields) to prevent partial saves from NULLing out existing data.

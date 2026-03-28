# Task 0029: Human-Readable URL Slugs

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: 0030, 0031, 0032, 0033

## Overview

Replace UUID-based URLs with human-readable slugs for works and authors. Current URLs (`/library/3718ce32-8654-4210-a48d-af55cb72d932`) are ugly, unrecognizable, and unshareable. New format for works: `/library/{title-slug}-by-{author-name}` (title max 30 chars, smart truncation at word boundaries). Authors: `/authors/{author-name-slug}`. Requires schema changes, a slug generation utility, a backfill migration, route renaming, and updating every internal link in the application.

## Implementation Details

### 1. Slug Generation Utility

**New file: `src/lib/utils/slugify.ts`**

Pure utility module (no `"use server"`, importable everywhere):

- `slugify(text: string): string` -- Lowercase, replace accented characters with ASCII equivalents via `String.normalize('NFD').replace(/[\u0300-\u036f]/g, '')`, replace non-alphanumeric with hyphens, collapse consecutive hyphens, trim leading/trailing hyphens.

- `truncateAtWordBoundary(text: string, maxLength: number): string` -- Truncate to `maxLength` chars. If truncation lands mid-word, backtrack to the previous hyphen. If the first word alone exceeds `maxLength`, use the first `maxLength` characters. Never return empty string.

- `generateWorkSlug(title: string, primaryAuthorName: string): string` -- Compose: `truncateAtWordBoundary(slugify(title), 30) + "-by-" + slugify(primaryAuthorName)`.
  - Example: `"The Brothers Karamazov"` + `"Fyodor Dostoevsky"` -> `the-brothers-karamazov-by-fyodor-dostoevsky`
  - Example with truncation: `"One Hundred Years of Solitude (Penguin Classics)"` + `"Gabriel Garcia Marquez"` -> `one-hundred-years-of-solitude-by-gabriel-garcia-marquez` (title part = 29 chars, truncated at word boundary)

- `generateAuthorSlug(name: string): string` -- `slugify(name)`. Example: `"Gabriel Garcia Marquez"` -> `gabriel-garcia-marquez`.

- `makeUnique(baseSlug: string, existingSlugs: string[]): string` -- If `baseSlug` exists in `existingSlugs`, append `-2`, `-3`, etc. until unique.

**Edge cases:**
- Titles with only non-Latin characters -- fall back to first 8 hex chars of UUID
- Single-word author names (e.g., "Voltaire") -- works fine as-is
- Empty author list (defensive, should never happen) -- omit the `-by-` segment
- Unicode normalization for diacritics (Garcia -> garcia, not garc-a)

### 2. Schema Changes

**File: `src/lib/db/schema/works.ts`** -- Add after `title` column:

```typescript
slug: text("slug").notNull().unique(),
```

**File: `src/lib/db/schema/authors.ts`** -- Add after `name` column:

```typescript
slug: text("slug").notNull().unique(),
```

Both columns: NOT NULL, UNIQUE index.

### 3. Drizzle Migration + Backfill

Run `pnpm db:generate` to create the migration. Since columns are NOT NULL but existing rows have no value, use a two-phase approach:

**Phase 1: Migration adds columns as nullable**

```sql
ALTER TABLE "works" ADD COLUMN "slug" text;
ALTER TABLE "authors" ADD COLUMN "slug" text;
```

**Phase 2: Backfill script (`src/lib/db/backfill-slugs.ts`)**

1. Fetch all works with primary authors: `db.query.works.findMany({ with: { workAuthors: { with: { author: true }, orderBy: asc(workAuthors.sortOrder), limit: 1 } } })`
2. For each work: generate slug via `generateWorkSlug(work.title, work.workAuthors[0]?.author.name ?? 'unknown')`
3. Resolve uniqueness via targeted query: `SELECT slug FROM works WHERE slug LIKE '{baseSlug}%'`
4. Update: `db.update(works).set({ slug }).where(eq(works.id, work.id))`
5. Similarly for authors: fetch all, generate `generateAuthorSlug(author.name)`, resolve conflicts, update

**Phase 3: Second migration adds constraints**

```sql
ALTER TABLE "works" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "works_slug_unique" ON "works" ("slug");
ALTER TABLE "authors" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "authors_slug_unique" ON "authors" ("slug");
```

### 4. Server Action Changes

**File: `src/lib/actions/works.ts`**

- **`createWork(input)`**: After inserting work and authors, generate slug:
  1. Get primary author name by querying the first authorId
  2. Call `generateWorkSlug(title, authorName)`
  3. Query existing slugs matching the base pattern for uniqueness
  4. Call `makeUnique(baseSlug, existingSlugs)`
  5. Update the work row with the slug
  6. Return work with slug

- **`updateWork(id, input)`**: If `title` changes OR `authorIds` changes, regenerate slug (exclude own slug from uniqueness check)

- **New: `getWorkBySlug(slug: string)`**: Same as `getWork(id)` but `where: eq(works.slug, slug)`. Keep `getWork(id)` for internal use.

- **`getWorks(opts?)`**: No change needed -- returns all columns, slug auto-included once added to schema.

- **`getLibraryStats()`**: Same -- `recentWorks` returns all columns, slug auto-included.

**File: `src/lib/actions/authors.ts`**

- **`createAuthor(input)`**: After insert, generate slug via `generateAuthorSlug(name)`, resolve uniqueness, update row
- **`findOrCreateAuthor(name)`**: Slug handled via `createAuthor()`
- **`updateAuthor(id, input)`**: If `name` changes, regenerate slug
- **New: `getAuthorBySlug(slug: string)`**: Same as `getAuthor(id)` but by slug. Keep `getAuthor(id)` for internal use.

### 5. Route Changes

**Rename directory:** `src/app/library/[id]/` -> `src/app/library/[slug]/`

Files affected:
- `src/app/library/[slug]/page.tsx` (renamed from `[id]`)
- `src/app/library/[slug]/work-media-section.tsx` (moves with directory)

Changes in `page.tsx`:
```typescript
// Before:
interface PageProps { params: Promise<{ id: string }>; }
const { id } = await params;
const work = await getWork(id);

// After:
interface PageProps { params: Promise<{ slug: string }>; }
const { slug } = await params;
const work = await getWorkBySlug(slug);
```

**Rename directory:** `src/app/authors/[id]/` -> `src/app/authors/[slug]/`

Files affected:
- `src/app/authors/[slug]/page.tsx` (renamed from `[id]`)
- `src/app/authors/[slug]/author-media-section.tsx` (moves with directory)

Same pattern: params `{ slug: string }`, fetch via `getAuthorBySlug(slug)`.

### 6. Link Updates -- Complete Inventory

Every location generating a URL to a work or author must switch from UUID to slug.

**Work links (`/library/${...}`):**

| File | Line | Current | Change |
|---|---|---|---|
| `src/components/books/book-card.tsx` | 28 | `href={/library/${workId}}` | Use `slug` prop instead of `workId` |
| `src/components/books/book-list.tsx` | 22 | `href={/library/${book.workId}}` | Use `book.slug` |
| `src/components/books/book-data-table.tsx` | 51 | `href={/library/${book.workId}}` | Use `book.slug` |
| `src/components/books/book-grid.tsx` | 35 | Spreads props to BookCard | Pass `slug` through |
| `src/app/page.tsx` | 102 | `href={/library/${work.id}}` | Use `work.slug` |
| `src/app/authors/[slug]/page.tsx` | 97 | `href={/library/${work.id}}` | Use `work.slug` (available from workAuthors relation) |
| `src/app/series/[id]/page.tsx` | 71 | `href={/library/${work.id}}` | Use `work.slug` |
| Add-book wizard | Post-creation navigation | `router.push(/library/${work.id})` | Use `work.slug` from `createWork()` return value |

**Author links (`/authors/${...}`):**

| File | Line | Current | Change |
|---|---|---|---|
| `src/components/authors/author-card.tsx` | 30 | `href={/authors/${id}}` | Use `slug` prop |
| `src/components/authors/author-list-item.tsx` | 29 | `href={/authors/${id}}` | Use `slug` prop |
| `src/app/authors/authors-shell.tsx` | 69 | `href={/authors/${author.id}}` | Use `author.slug` |

**Interface/type updates required:**

| Interface | File | Change |
|---|---|---|
| `BookCardProps` | `book-card.tsx` | Add `slug: string` (replace `workId` in href, keep `workId` for React key) |
| `BookGridItem` | `book-grid.tsx` | Add `slug: string` |
| `BookListItem` | `book-list.tsx` | Add `slug: string` |
| `DetailedBookItem` | `book-data-table.tsx` | Add `slug: string` |
| `BookItem` | `library-shell.tsx` | Add `slug: string` |
| `BookItem` | `library-view.tsx` | Add `slug: string` |
| `AuthorItem` | `authors-shell.tsx` | Add `slug: string` |
| `AuthorCardProps` | `author-card.tsx` | Add `slug: string` |
| `AuthorListItemProps` | `author-list-item.tsx` | Add `slug: string` |

**Data flow updates:** `library/page.tsx` builds the `books` array with `workId: work.id` -- must add `slug: work.slug`. `authors/page.tsx` builds the `authors` array -- must add `slug: a.slug`.

### 7. Validation Schema

No slug field in `createWorkSchema` or `updateWorkSchema` -- slug is auto-generated, never user-provided. No changes.

### 8. Documentation Updates

**File: `docs/02_DATA_MODEL.md`** -- Add `slug` column to works and authors table docs.

**File: `docs/04_ROUTES_AND_VIEWS.md`** -- Update route map: `/library/[id]` -> `/library/[slug]`, `/authors/[id]` -> `/authors/[slug]`.

### 9. API Routes

API routes under `src/app/api/` continue to accept UUIDs for backward compatibility. Only Next.js page routes change to slugs. No API route changes needed.

### 10. Command Palette

`src/components/layout/command-palette.tsx` only has static navigation links and actions (no links to specific works/authors). No changes needed.

## Testing Checklist

- [ ] Slug generation handles accented characters (Garcia Marquez, Dostoevsky)
- [ ] Slug generation handles very long titles (>30 chars truncated at word boundary)
- [ ] Slug uniqueness: two works with identical title+author get `-2` suffix
- [ ] Backfill script correctly generates slugs for all existing works and authors
- [ ] `/library/[slug]` resolves to the correct work detail page
- [ ] `/authors/[slug]` resolves to the correct author detail page
- [ ] Old UUID URLs return 404 (clean break, no redirect)
- [ ] All internal links use slugs (dashboard, library grid/list/table, author grid/list/table, author detail -> works, series detail -> works)
- [ ] Post-creation navigation in wizard uses slug
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds

## Completion Notes

Implemented 2026-03-28. All phases completed:

- Slug utility at `src/lib/utils/slugify.ts` with all five functions.
- Schema: `slug TEXT UNIQUE` added to `works` and `authors` (nullable, migration 0004).
- Backfill script at `src/lib/db/backfill-slugs.ts`; run against Neon, 1 author and 1 work migrated.
- Server actions: `getWorkBySlug`, `getAuthorBySlug` added; `createWork` and `createAuthor` generate slugs on creation; `updateWork` and `updateAuthor` regenerate slugs when title/name changes.
- Routes renamed: `src/app/library/[id]` → `src/app/library/[slug]` and `src/app/authors/[id]` → `src/app/authors/[slug]`.
- All internal links updated across 12 files (book-card, book-grid, book-list, book-data-table, library-shell, library-view, library/page, authors-shell, authors/page, author-card, author-list-item, series/[id]/page, app/page, wizard).
- Docs updated: `02_DATA_MODEL.md` and `04_ROUTES_AND_VIEWS.md`.
- `tsx` dev dependency added for backfill script execution.
- `pnpm typecheck`: zero errors. `pnpm build`: succeeds.

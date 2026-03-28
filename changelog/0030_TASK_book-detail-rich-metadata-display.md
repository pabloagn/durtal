# Task 0030: Book Detail Page -- Rich Metadata Display

**Status**: Not Started
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0029
**Blocks**: 0031, 0032, 0033

## Overview

Complete overhaul of the work detail page (`src/app/library/[slug]/page.tsx`) to display ALL metadata stored in the database. The current page (267 lines) shows only a subset of available data: title, plain-text author names, year, rating, language badge, anthology badge, catalogue status badge, description, series name (plain text), subjects (pills), media section, editions (with partial detail), and notes.

Missing from current display: clickable author links, acquisition priority, work type, categories, themes, literary movements, art types, art movements, keywords, attributes, edition genres/tags (fetched but not rendered), edition page count/dimensions/weight/imprint/edition name/printing number, instance acquisition details, instance collector details (partially shown), instance dust jacket/slipcase, instance digital details, external links, and disposition details.

This task extends `getWork()` to fetch ALL taxonomy relations and builds a comprehensive, structured detail page following the gothic-minimal design language.

## Implementation Details

### 1. Extend `getWork()` / `getWorkBySlug()` to Fetch All Relations

**File: `src/lib/actions/works.ts`**

The `worksRelations` in `src/lib/db/schema/works.ts` already defines all these relations: `workCategories`, `workThemes`, `workLiteraryMovements`, `workArtTypes`, `workArtMovements`, `workKeywords`, `workAttributes`, `series`, `workType`. They just aren't loaded in the query.

Add to the `with` clause of `getWork()` and `getWorkBySlug()`:

```typescript
with: {
  // Existing (keep all):
  workAuthors: { with: { author: true }, orderBy: asc(workAuthors.sortOrder) },
  workSubjects: { with: { subject: true } },
  editions: { /* existing deep load with instances, contributors, genres, tags */ },
  media: true,
  // NEW:
  workType: true,
  series: true,
  workCategories: { with: { category: true } },
  workThemes: { with: { theme: true } },
  workLiteraryMovements: { with: { literaryMovement: true } },
  workArtTypes: { with: { artType: true } },
  workArtMovements: { with: { artMovement: true } },
  workKeywords: { with: { keyword: true } },
  workAttributes: { with: { attribute: true } },
}
```

No schema changes needed -- only the query changes.

### 2. Type Updates

**File: `src/lib/types/index.ts`** (or inline in actions file)

Extend the return type to include all new relations. Since Drizzle's relational queries infer types automatically, the TypeScript types will flow through from the `with` clause. If `WorkWithRelations` is manually defined, extend it:

```typescript
workType: WorkType | null;
series: Series | null;
workCategories: { category: BookCategory }[];
workThemes: { theme: Theme }[];
workLiteraryMovements: { literaryMovement: LiteraryMovement }[];
workArtTypes: { artType: ArtType }[];
workArtMovements: { artMovement: ArtMovement }[];
workKeywords: { keyword: Keyword }[];
workAttributes: { attribute: Attribute }[];
```

Add imported types for `BookCategory`, `Theme`, `LiteraryMovement`, `ArtType`, `ArtMovement`, `Keyword`, `Attribute`, `Series`, `WorkType` using `InferSelectModel<typeof table>`.

### 3. Page Structure -- Complete Rewrite

**File: `src/app/library/[slug]/page.tsx`**

The page is a server component. New structure:

```
[Back to library link]

[HEADER SECTION]
  Poster image (if exists) | Title (serif h1)
                           | Author links (clickable, comma-separated -> /authors/{slug})
                           | Year | Rating stars | Work type badge
                           | Badges: language, anthology, catalogue status, acquisition priority

[DESCRIPTION SECTION]
  Description text (if exists)

[METADATA GRID]
  Two-column grid of key-value pairs:
  - Original Language, Original Year
  - Work Type, Catalogue Status
  - Acquisition Priority, Is Anthology
  - Series (linked to /series/[id] if seriesId set, with position)

[TAXONOMY SECTION]
  Subsections for each taxonomy type (shown only when non-empty):
  - Subjects (pills, default variant)
  - Categories (pills, muted variant)
  - Themes (pills, blue variant)
  - Literary Movements (pills, gold variant)
  - Art Types / Art Movements (pills, sage variant)
  - Keywords (pills, default variant)
  - Attributes (pills, muted variant, grouped by category if set)

[MEDIA SECTION]
  Existing WorkMediaSection component (poster/background upload, gallery)

[EDITIONS SECTION]
  For each edition, an expanded card:

  [Edition Header]
    Title + subtitle
    Publisher | Imprint | Year | Language badge | Binding badge
    ISBN-13 (mono) | 1st ed badge | Limited ed badge

  [Edition Details Grid] (two-column key-value pairs)
    Page Count, Dimensions (H x W x D mm), Weight (g)
    Edition Name, Edition Number, Printing Number
    Publication Country, Publication Date (full)
    Is Translated, Illustration Type
    Limited Edition Count (if limited)
    Description (edition-specific, if different from work)
    Table of Contents (if present)

  [Edition Genres & Tags]
    Genre pills (from editionGenres -- already fetched but currently not rendered)
    Tag pills (from editionTags -- already fetched but currently not rendered)

  [Edition Contributors]
    Grouped by role: "Translated by [linked name]", "Edited by [linked name]"
    Each contributor name is a Link to /authors/{slug}

  [Instances] (per edition)
    For each instance, expanded display:
    - Location / Sub-location
    - Format badge | Condition badge | Status badge
    - Dust jacket / Slipcase indicators
    - Signed badge + "signed by" name (if signed)
    - First printing badge
    - Inscription (if present)
    - Provenance (if present)

    [Acquisition Details] (shown if any acquisition field set)
      Type | Date | Source | Price + Currency

    [Digital Details] (shown if format is digital)
      Calibre ID | Calibre URL (linked) | File size (human-readable)

    [Lending Status]
      Lent to + lent date (if lent out)

    [Disposition Details] (shown if status is deaccessioned)
      Type | Date | To | Price | Notes

[NOTES SECTION]
  Work-level notes

[EXTERNAL LINKS SECTION]
  Metadata source info
  Edition external IDs: Google Books, Open Library, Goodreads, Calibre-Web links
```

### 4. Component Extraction

The page will grow significantly. Extract reusable sub-components:

**New file: `src/app/library/[slug]/work-metadata-grid.tsx`**

Server component. Receives work object, renders two-column key-value grid. Uses CSS Grid `grid-cols-2 gap-x-8 gap-y-2`. Labels: `text-xs text-fg-muted`. Values: `text-sm text-fg-secondary`.

**New file: `src/app/library/[slug]/work-taxonomy-section.tsx`**

Server component. Receives all taxonomy arrays, renders labeled pill groups. Each group: heading (`text-xs text-fg-muted uppercase tracking-wide`) + flex-wrap Badge pills. Different badge variants per taxonomy type for visual distinction. Entire section hidden if all arrays empty.

**New file: `src/app/library/[slug]/edition-detail-card.tsx`**

Server component. Receives an edition with full relations. Renders:
- Card with CardHeader (title/publisher/identifiers) and CardContent (detail grid, genres/tags, contributors, instances)
- Edition detail grid as collapsible section (expanded by default for first edition, collapsed for subsequent ones -- requires a thin client wrapper for toggle state)

**New file: `src/app/library/[slug]/instance-detail.tsx`**

Server component. Receives an instance with location/subLocation. Renders all instance metadata in a structured display: badges row, detail sections for acquisition/collector/digital/disposition.

### 5. Clickable Author Links

**Work detail page header** (currently line 57):

```tsx
// Before:
{primaryAuthors.map((a) => a.name).join(", ")}

// After:
{primaryAuthors.map((a, i) => (
  <span key={a.id}>
    {i > 0 && ", "}
    <Link href={`/authors/${a.slug}`}
          className="text-fg-secondary transition-colors hover:text-accent-rose">
      {a.name}
    </Link>
  </span>
))}
```

**Edition contributors** (currently line 204):

```tsx
// Before:
{c.author.name}

// After:
<Link href={`/authors/${c.author.slug}`}
      className="text-fg-secondary hover:text-accent-rose">
  {c.author.name}
</Link>
```

### 6. Display Formatting Utilities

**New file: `src/lib/utils/format.ts`**

- `formatFileSize(bytes: number): string` -- e.g., "2.4 MB", "340 KB"
- `formatDimensions(h?: number | null, w?: number | null, d?: number | null): string | null` -- e.g., "230 x 150 x 25 mm", returns null if all undefined
- `formatPrice(price: string | number | null, currency?: string | null): string | null` -- e.g., "EUR 29.99"
- `formatDate(dateStr: string | null): string | null` -- formatted date display

### 7. Design Decisions

- **Taxonomy sections use distinct badge variants** per type for visual distinction
- **Section headings**: serif font, `text-sm`, `text-fg-secondary` (existing pattern)
- **Sections separated by vertical spacing** (`mb-8`), no horizontal rules
- **Empty fields are simply not shown** -- no "N/A" or dashes for missing data
- **Edition detail grid collapsed by default** for editions beyond the first (thin client toggle wrapper)
- **Instance details shown inline** (not collapsible) -- the detail page is where you see everything
- **External links at bottom**: if edition has `googleBooksId`, `openLibraryKey`, `goodreadsId`, show as linked text

### 8. Files Changed Summary

| File | Change |
|---|---|
| `src/lib/actions/works.ts` | Extend `getWork`/`getWorkBySlug` query with all taxonomy relations |
| `src/lib/types/index.ts` | Extend `WorkWithRelations` with taxonomy types |
| `src/app/library/[slug]/page.tsx` | Complete rewrite of page layout |
| `src/app/library/[slug]/work-metadata-grid.tsx` | New: metadata key-value grid component |
| `src/app/library/[slug]/work-taxonomy-section.tsx` | New: taxonomy pill sections component |
| `src/app/library/[slug]/edition-detail-card.tsx` | New: expanded edition card component |
| `src/app/library/[slug]/instance-detail.tsx` | New: expanded instance display component |
| `src/lib/utils/format.ts` | New: display formatting utilities |

## Testing Checklist

- [ ] All taxonomy types display when populated (subjects, categories, themes, literary movements, art types, art movements, keywords, attributes)
- [ ] Empty taxonomy types are hidden (no empty headers or sections)
- [ ] Author names are clickable links to the correct author page
- [ ] Edition contributors are clickable links to author pages
- [ ] Edition detail grid shows all fields: page count, dimensions, weight, imprint, edition name, printing number, publication country, illustration type
- [ ] Edition genres and tags display as pills
- [ ] Instance acquisition details display when present (type, date, source, price)
- [ ] Instance collector details display (signed by, inscription, provenance, first printing)
- [ ] Instance dust jacket and slipcase indicators display
- [ ] Instance digital details display for digital formats (calibre URL linked, file size formatted)
- [ ] Instance disposition details display for deaccessioned instances
- [ ] External links section shows when edition external IDs exist
- [ ] Page renders correctly with minimal data (only required fields populated)
- [ ] Page renders correctly with maximal data (all fields populated)
- [ ] Metadata grid displays work type and series (linked to /series/[id])
- [ ] Acquisition priority badge displays with appropriate variant
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds

## Completion Notes

[Left empty]

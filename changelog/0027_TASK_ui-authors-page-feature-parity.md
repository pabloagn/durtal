# Task 0027: UI — Authors Page Feature Parity with Library

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Bring the Authors page (`/authors`) up to feature parity with the Library page (`/library`). Currently the Authors page is a static table with 4 hardcoded columns, no search input, no pagination, no view modes, no sorting, and no column customization. The Library page has all of these. The Authors page needs the same interaction model: view mode toggle, sort controls, search bar, column configuration with session persistence, grid size slider, and pagination.

---

## Current State

**Authors page** (`src/app/authors/page.tsx`):
- Static `<Table>` with 4 hardcoded columns: Name, Nationality, Years, Works count
- Accepts `q` search param via URL but has **no search input field** in the UI
- No pagination (hardcoded limit of 100)
- No view mode toggle
- No sort controls (hardcoded `asc(sortName)`)
- No column customization
- No localStorage persistence

**Library page** has:
- 3 view modes (grid, list, detailed/table) persisted in localStorage (`durtal-view-mode`)
- Grid size slider (2-8 columns) persisted in localStorage (`durtal-grid-columns`)
- Column configuration dialog (14 columns, visibility + order) persisted in localStorage (`durtal-column-config`)
- Sort controls (4 options) persisted via URL param (`sort`)
- Search input with 300ms debounce persisted via URL param (`q`)
- Pagination (48 items/page) via URL param (`page`)

---

## Target Architecture

Mirror the Library page's component composition pattern, adapted for author data.

### Component Tree

```
/authors/page.tsx (async, force-dynamic)
├── PageHeader (title: "Authors", action: none)
└── Suspense
    └── AuthorsContent (async — fetches data)
        └── AuthorsShell (client — manages view state)
            ├── AuthorsFilters (client)
            │   ├── Search input (debounced, updates URL ?q=)
            │   ├── Sort buttons (updates URL ?sort=)
            │   ├── ViewModeSwitcher (shared component, localStorage)
            │   └── GridSizeSlider (shared component, localStorage, grid mode only)
            └── AuthorsView (client — delegates to sub-view)
                ├── AuthorGrid → AuthorCard (if "grid")
                ├── AuthorList (if "list")
                └── AuthorDataTable + ColumnConfigDialog (if "detailed")
```

### Shared vs. New Components

**Reuse from Library (no changes needed):**
- `ViewModeSwitcher` (`src/components/books/view-mode-switcher.tsx`) — already generic
- `GridSizeSlider` (`src/components/books/grid-size-slider.tsx`) — already generic
- `ColumnConfigDialog` (`src/components/books/column-config-dialog.tsx`) — already generic
- `useLocalStorage` hook (`src/lib/hooks/use-local-storage.ts`)
- `PageHeader`, `Table`, `EmptyState` UI primitives

**New components to create under `src/components/authors/`:**
- `author-card.tsx` — Grid view card for an author
- `author-grid.tsx` — Grid layout rendering AuthorCards
- `author-list.tsx` — Compact list view for authors
- `author-data-table.tsx` — Detailed table view with sortable columns
- `authors-view.tsx` — View mode delegator (like `library-view.tsx`)

**Modify:**
- `src/app/authors/page.tsx` — Refactor to match Library page pattern
- `src/lib/actions/authors.ts` — Add sort parameter to `getAuthors`

---

## Author Data Shape

```typescript
interface AuthorItem {
  id: string;
  name: string;
  sortName: string | null;
  firstName: string | null;
  lastName: string | null;
  gender: string | null;
  nationality: string | null;
  birthYear: number | null;
  deathYear: number | null;
  bio: string | null;
  photoUrl: string | null;       // resolved from photo_s3_key
  website: string | null;
  worksCount: number;
  createdAt: string;
}
```

---

## Visual Consistency Requirement

The Authors page MUST use the exact same typography, sizing, spacing, and color tokens as the Library page. The Library page is the reference implementation for all list/table/grid views across the application. Specifically:

- **Table column headers**: Same font family, weight, size, color, and letter-spacing as Library's `BookDataTable`
- **Table cell text**: Same font size, color, and line-height
- **List item text**: Same hierarchy (primary/secondary text sizing and color)
- **Grid card text**: Same heading size, secondary text size, badge sizing
- **Sort/filter toolbar**: Same layout, spacing, button sizing
- **Pagination controls**: Same styling

The current Authors page has broken column header styling (nearly invisible text). This must be fixed by using the same component primitives and CSS classes as Library.

---

## View Modes

### Grid View

Author cards in a responsive grid (same column system as Library: 2-8 columns).

Each card shows:
- Author photo (if available, fallback to initials or icon)
- Name (primary text)
- Nationality (secondary text)
- Birth–death years (e.g., "1899–1986", "1985–")
- Works count badge

### List View

Compact rows with:
- Small photo thumbnail (or icon)
- Name
- Nationality
- Years
- Works count (right-aligned)

### Detailed/Table View

Full data table with configurable columns.

**Available Columns (10 total):**

| Key | Label | Default Visible | Default Order |
|-----|-------|-----------------|---------------|
| `name` | Name | yes | 0 |
| `nationality` | Nationality | yes | 1 |
| `years` | Years | yes | 2 |
| `gender` | Gender | no | 3 |
| `worksCount` | Works | yes | 4 |
| `birthYear` | Born | no | 5 |
| `deathYear` | Died | no | 6 |
| `bio` | Bio | no | 7 |
| `website` | Website | no | 8 |
| `addedDate` | Added | no | 9 |

Column visibility and order persisted in localStorage as `durtal-authors-column-config`.

---

## Sort Options

Available via URL param `?sort=`:

| Value | Label | Query | Default |
|-------|-------|-------|---------|
| `name` | Name | `asc(authors.sortName)` | yes |
| `recent` | Recent | `desc(authors.createdAt)` | no |
| `birth` | Birth Year | `asc(authors.birthYear)` NULLS LAST | no |
| `works` | Works Count | Derived, `desc(count)` | no |

---

## Search

- Input field with Lucide `Search` icon
- Placeholder: "Search authors..."
- 300ms debounce
- ILIKE on `authors.name` (already implemented in `getAuthors`)
- Resets pagination to page 1 on change

---

## Pagination

- **Page size**: 48 (same as Library)
- **URL param**: `?page=`
- **Controls**: Previous/Next buttons + "page X / totalPages"
- **Total count**: Shown below pagination
- **Reset**: Page resets to 1 when search or sort changes

---

## localStorage Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `durtal-authors-view-mode` | `"grid" \| "list" \| "detailed"` | `"grid"` | Active view mode |
| `durtal-authors-grid-columns` | `number` (2-8) | `5` | Grid columns (slightly fewer than Library since author cards are wider) |
| `durtal-authors-column-config` | `Array<{ key, visible, order }>` | See table above | Table column visibility and order |

---

## Database Query Changes

Update `getAuthors` in `src/lib/actions/authors.ts`:

```typescript
export async function getAuthors(opts?: {
  search?: string;
  limit?: number;       // default 48
  offset?: number;      // default 0
  sort?: "name" | "recent" | "birth" | "works";
}): Promise<{ authors: AuthorItem[]; total: number }>
```

- Add `sort` parameter with 4 options
- Change default limit from 100 to 48
- Return `total` count for pagination
- For `works` sort: use a subquery or lateral join to count works per author

---

## Implementation Steps

- [x] Extract `src/components/shared/entity-filters.tsx` — generic search/sort/view/slider bar (DRY)
- [x] Extract `src/components/shared/data-table.tsx` — generic sortable table with column config (DRY)
- [x] Refactor `src/app/library/filters.tsx` — now wraps `EntityFilters` (no behavior change)
- [x] Refactor `src/components/books/book-data-table.tsx` — now wraps `DataTable` (no behavior change)
- [x] Update `getAuthors` action: add sort parameter (`name`/`recent`/`birth`/`works`), change default limit to 48
- [x] Create `src/components/authors/author-card.tsx` — grid card (same styles as BookCard)
- [x] Create `src/components/authors/author-list-item.tsx` — list row (same styles as BookList)
- [x] Create `src/app/authors/authors-shell.tsx` — client shell with EntityFilters + 3 view modes + DataTable
- [x] Rebuild `src/app/authors/page.tsx` — shell pattern, URL params (`q`, `sort`, `page`), pagination
- [x] Wire up localStorage: `durtal-authors-view-mode`, `durtal-authors-grid-columns`, `durtal-authors-column-config`
- [x] Shared components work without modification (ViewModeSwitcher, GridSizeSlider, ColumnConfigDialog)
- [x] Run `pnpm typecheck` — passes clean
- [ ] Test all 3 view modes render correctly
- [ ] Test sort options work end-to-end
- [ ] Test search with debounce
- [ ] Test pagination
- [ ] Test column config persistence across page reloads
- [ ] Run `pnpm lint`

# Task 0032: Taxonomy Management on Book Detail

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0029, 0030
**Blocks**: None

## Overview

Create server actions for fetching and updating all work-level taxonomy types (categories, themes, literary movements, art types, art movements, keywords, attributes) and build UI for assigning/removing taxonomy items on the work detail page. Currently, the junction tables exist in the schema and `getWork()` fetches them (after Task 0030), but there are no fetch actions for the reference tables and no update actions for the junction tables beyond subjects.

The schema (Tasks 0009-0014) created 8 work-level taxonomy tables and their junction tables. The ingestion pipeline (Tasks 0015-0016) seeds them. But the web UI has no way to manage taxonomy assignments on existing works.

## Implementation Details

### 1. New Server Actions -- Fetch All Taxonomy Reference Data

**File: `src/lib/actions/taxonomy.ts`**

Add fetch actions for each taxonomy type. Follow existing pattern of `getSubjects()`, `getGenres()`, `getTags()`:

```typescript
// ── Categories ──
export async function getCategories() {
  return db.query.bookCategories.findMany({
    orderBy: asc(bookCategories.sortOrder),
    with: { parent: true, children: true },
  });
}

// ── Themes ──
export async function getThemes() {
  return db.query.themes.findMany({
    orderBy: asc(themes.sortOrder),
    with: { parent: true, children: true },
  });
}

// ── Literary Movements ──
export async function getLiteraryMovements() {
  return db.query.literaryMovements.findMany({
    orderBy: asc(literaryMovements.sortOrder),
    with: { parent: true, children: true },
  });
}

// ── Art Types ──
export async function getArtTypes() {
  return db.query.artTypes.findMany({
    orderBy: asc(artTypes.name),
  });
}

// ── Art Movements ──
export async function getArtMovements() {
  return db.query.artMovements.findMany({
    orderBy: asc(artMovements.name),
  });
}

// ── Keywords ──
export async function getKeywords() {
  return db.query.keywords.findMany({
    orderBy: asc(keywords.name),
  });
}

// ── Attributes ──
export async function getAttributes() {
  return db.query.attributes.findMany({
    orderBy: asc(attributes.name),
  });
}
```

**Required imports to add to `taxonomy.ts`:**

```typescript
import {
  bookCategories, themes, literaryMovements,
  artTypes, artMovements, keywords, attributes,
  workCategories, workThemes, workLiteraryMovements,
  workArtTypes, workArtMovements, workKeywords, workAttributes,
  workSubjects,
} from "@/lib/db/schema";
```

### 2. New Server Action -- Update Work Taxonomy

**File: `src/lib/actions/taxonomy.ts`**

Single comprehensive update action for all work-level taxonomy junctions:

```typescript
export async function updateWorkTaxonomy(
  workId: string,
  input: {
    subjectIds?: string[];
    categoryIds?: string[];
    themeIds?: string[];
    literaryMovementIds?: string[];
    artTypeIds?: string[];
    artMovementIds?: string[];
    keywordIds?: string[];
    attributeIds?: string[];
  },
)
```

For each provided taxonomy type (value !== `undefined`), delete-and-reinsert the junction rows (same pattern as `updateWork` for `authorIds`):

1. `DELETE FROM work_subjects WHERE work_id = ?` then `INSERT` new rows
2. `DELETE FROM work_categories WHERE work_id = ?` then `INSERT` new rows
3. Same for work_themes, work_literary_movements, work_art_types, work_art_movements, work_keywords, work_attributes
4. Update `works.updatedAt` timestamp

Design decision: A single action for all taxonomy types reduces network round-trips when editing multiple types simultaneously. The caller sends only the types being modified (others are `undefined` and skipped).

### 3. Extract Shared MultiSelectSection Component

**Current state:** The `MultiSelectSection` component is defined locally inside `src/components/books/categorization-form.tsx` and not exported. It provides filterable checkbox lists with selected-item badges.

**New file: `src/components/shared/multi-select-section.tsx`**

Extract `MultiSelectSection` into a standalone exported component:

```typescript
interface MultiSelectSectionProps {
  label: string;
  items: { id: string; name: string }[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}
```

Features (matching current implementation):
- Label heading
- Filter input (shown when > 8 items)
- Checkbox list with max-height scroll
- Selected items as removable badge pills below

**File: `src/components/books/categorization-form.tsx`** -- Refactor to import and use the shared `MultiSelectSection` instead of the local definition. Verify the add-book wizard still works after refactoring.

### 4. Taxonomy Edit Dialog

**New file: `src/app/library/[slug]/work-taxonomy-edit-dialog.tsx`**

`"use client"` component:

```typescript
interface WorkTaxonomyEditDialogProps {
  workId: string;
  // Current assignments (extracted from work object)
  currentSubjectIds: string[];
  currentCategoryIds: string[];
  currentThemeIds: string[];
  currentLiteraryMovementIds: string[];
  currentArtTypeIds: string[];
  currentArtMovementIds: string[];
  currentKeywordIds: string[];
  currentAttributeIds: string[];
  // Available reference data
  subjects: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  themes: { id: string; name: string }[];
  literaryMovements: { id: string; name: string }[];
  artTypes: { id: string; name: string }[];
  artMovements: { id: string; name: string }[];
  keywords: { id: string; name: string }[];
  attributes: { id: string; name: string }[];
}
```

Renders:
- An "Edit taxonomy" button (ghost variant, Tag icon from Lucide)
- On click, opens Dialog (`max-w-3xl` for width)
- Dialog body: 8 `MultiSelectSection` instances, one per taxonomy type
- Each section labeled with the taxonomy name
- Sections are always visible (not collapsible), scrollable dialog body
- "Save" button at the bottom
- On save: calls `updateWorkTaxonomy(workId, { ... })` with all 8 arrays
- Shows toast success/error
- `router.refresh()` to reload data
- Dialog closes on success

### 5. Data Fetching on Work Detail Page

**File: `src/app/library/[slug]/page.tsx`**

Add parallel fetches for all taxonomy reference data:

```typescript
const [
  work,
  allSubjects, allCategories, allThemes, allLiteraryMovements,
  allArtTypes, allArtMovements, allKeywords, allAttributes,
  // ... plus fetches from Task 0031
] = await Promise.all([
  getWorkBySlug(slug),
  getSubjects(), getCategories(), getThemes(), getLiteraryMovements(),
  getArtTypes(), getArtMovements(), getKeywords(), getAttributes(),
  // ...
]);
```

**Performance note:** These are 8 simple `SELECT * FROM table ORDER BY name/sort_order` queries. Taxonomy tables are small (typically <500 rows each). Running in parallel via `Promise.all`, total latency is dominated by the slowest single query (~20-50ms on Neon). Acceptable.

Pass the reference data to the `WorkTaxonomyEditDialog` component along with the current assignment IDs extracted from the work object.

### 6. Subject Management Consolidation

Currently, `updateWork()` handles subjects via `subjectIds`. With the new `updateWorkTaxonomy`, subjects are also manageable there.

Decision: Remove subjects from the work edit dialog (Task 0031) and manage ALL taxonomy through the taxonomy edit dialog (this task). This provides a unified taxonomy management experience and avoids having subjects editable from two places.

The `updateWork` action continues to support `subjectIds` for backward compatibility (the add-book wizard uses it), but the edit UI routes all taxonomy changes through `updateWorkTaxonomy`.

### 7. Edition-Level Taxonomy Note

Edition-level genres and tags will be editable in Task 0033 (Edition & Instance Management UI) via the edition edit dialog. The existing `updateEdition()` already handles `genreIds` and `tagIds`. No work needed here for edition taxonomy.

### 8. Files Changed Summary

| File | Change |
|---|---|
| `src/lib/actions/taxonomy.ts` | Add 7 fetch actions + `updateWorkTaxonomy` action + new imports |
| `src/app/library/[slug]/page.tsx` | Fetch all taxonomy reference data, render taxonomy edit button |
| `src/app/library/[slug]/work-taxonomy-edit-dialog.tsx` | New: client component with 8 multi-select sections |
| `src/components/shared/multi-select-section.tsx` | New: extracted reusable multi-select component |
| `src/components/books/categorization-form.tsx` | Refactor to use shared `MultiSelectSection` |

## Testing Checklist

- [ ] All 7 new fetch actions return correct data
- [ ] `updateWorkTaxonomy` correctly updates each junction table (delete + reinsert)
- [ ] `updateWorkTaxonomy` handles partial updates (only some taxonomy types provided)
- [ ] `updateWorkTaxonomy` handles empty arrays (clears all assignments for that type)
- [ ] Taxonomy edit dialog opens with current assignments pre-selected
- [ ] Selecting/deselecting items works for all 8 taxonomy types
- [ ] Search/filter works within each taxonomy section (for types with >8 items)
- [ ] Saving updates the database and refreshes the page
- [ ] Newly assigned taxonomy items appear in the read-only taxonomy display (from Task 0030)
- [ ] Removing all items from a taxonomy type clears the junction rows
- [ ] Toast feedback on success/failure
- [ ] Add-book wizard `CategorizationForm` still works after `MultiSelectSection` extraction
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds

## Completion Notes

[Left empty]

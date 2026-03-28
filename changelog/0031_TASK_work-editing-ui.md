# Task 0031: Work Editing UI

**Status**: Not Started
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0029, 0030
**Blocks**: None

## Overview

Add an edit interface for work-level fields on the book detail page. Currently, the `updateWork` server action exists in `src/lib/actions/works.ts` but no UI calls it. Users have no way to change catalogue status, acquisition priority, rating, description, notes, series, anthology flag, work type, title, language, year, or author assignments after initial creation.

This task adds an "Edit" button to the work detail page header that opens a dialog with the full work editing form. The form reuses existing UI patterns (Input, Textarea, Select, Badge) and follows the gothic-minimal design language.

## Implementation Details

### 1. Edit Button on Work Detail Page

**File: `src/app/library/[slug]/page.tsx`**

Add a `WorkEditButton` client component in the header area, next to the title. The page is a server component, so the edit button and its dialog must be a client component.

The page needs additional parallel data fetches for the edit dialog's reference data:

```typescript
const [work, allAuthors, allSeries, allWorkTypes] = await Promise.all([
  getWorkBySlug(slug),
  getAuthors({ limit: 1000 }),  // all authors for the selector
  getSeries(),                   // all series for the selector
  getWorkTypes(),                // all work types for the selector -- NEW action
]);
```

### 2. New Server Action: `getWorkTypes()`

**File: `src/lib/actions/taxonomy.ts`** (or new file `src/lib/actions/work-types.ts`)

```typescript
export async function getWorkTypes() {
  return db.query.workTypes.findMany({ orderBy: asc(workTypes.name) });
}
```

The `workTypes` table already exists in the schema (`src/lib/db/schema/work-types.ts`). Verify `getSeries()` in `src/lib/actions/series.ts` returns `{ id, title }[]` -- it exists and is sufficient.

### 3. Work Edit Dialog Component

**New file: `src/app/library/[slug]/work-edit-dialog.tsx`**

`"use client"` component. Renders:
- An edit button (Pencil icon + "Edit" text, ghost variant)
- On click, opens Dialog (using existing `src/components/ui/dialog.tsx`)
- Dialog title: "Edit Work"
- Dialog body: sectioned form with all editable work fields
- Dialog width: `max-w-2xl` to accommodate the form

```typescript
interface WorkEditDialogProps {
  work: {
    id: string;
    slug: string;
    title: string;
    originalLanguage: string;
    originalYear: number | null;
    description: string | null;
    seriesName: string | null;
    seriesPosition: string | null;
    seriesId: string | null;
    isAnthology: boolean;
    workTypeId: string | null;
    notes: string | null;
    rating: number | null;
    catalogueStatus: string;
    acquisitionPriority: string;
  };
  authors: { id: string; name: string; role: string }[];
  availableAuthors: { id: string; name: string }[];
  availableSeries: { id: string; title: string }[];
  availableWorkTypes: { id: string; name: string }[];
}
```

### 4. Form Sections

**Section 1: Core Details**
- Title (Input, required)
- Original Language (Select, from LANGUAGES constant or text input)
- Original Year (Input, number, nullable)
- Work Type (Select, from `availableWorkTypes`, nullable)
- Is Anthology (checkbox)

**Section 2: Status**
- Catalogue Status (Select: tracked, shortlisted, wanted, on_order, accessioned, deaccessioned)
- Acquisition Priority (Select: none, low, medium, high, urgent)
- Rating (1-5 star selector or number Select)

**Section 3: Description & Notes**
- Description (Textarea, nullable)
- Notes (Textarea, nullable)

**Section 4: Series**
- Series (Select from `availableSeries`, nullable, clears `seriesName`)
- Series Position (Input, text, nullable)

**Section 5: Authors**
- Current authors list: each row shows name, role badge (Select: "author" / "co_author"), remove button (X)
- "Add author" button: opens inline search/select combobox
  - Filters `availableAuthors` by name as user types
  - On select, adds author with default role "author"
  - "Create new author: {typed name}" option if no match found (calls `findOrCreateAuthor`)
- Minimum 1 author enforced: disable remove on last author, show toast if attempted

### 5. Form Submission

Uses `useTransition` and `startTransition`:

```typescript
const [isPending, startTransition] = useTransition();

function handleSubmit() {
  startTransition(async () => {
    await updateWork(work.id, {
      title, originalLanguage, originalYear, description,
      seriesId, seriesName, seriesPosition,
      isAnthology, workTypeId, notes, rating,
      catalogueStatus, acquisitionPriority,
      authorIds: authors.map((a) => ({ authorId: a.id, role: a.role })),
    });
    toast.success("Work updated");
    router.refresh();
    closeDialog();
  });
}
```

Loading state: submit button disabled + spinner during pending. Toast on success or error. Dialog closes after successful save. `router.refresh()` to reload server component data.

### 6. Server Action Updates

**File: `src/lib/actions/works.ts`** -- `updateWork(id, input)`

Current `updateWork` handles `authorIds` and `subjectIds` but does NOT handle:
- `workTypeId` -- needs to be passed through to `.set()` call
- `seriesId` -- needs to be passed through to `.set()` call

Update to destructure these fields from `input` and include them in the `workData` object that gets passed to `db.update(works).set(...)`.

Also ensure slug regeneration (from Task 0029) happens when title or authorIds change.

### 7. Validation Schema Updates

**File: `src/lib/validations/works.ts`**

Add to `createWorkSchema` (flows through to `updateWorkSchema` via `.partial()`):

```typescript
workTypeId: z.string().uuid().nullable().optional(),
seriesId: z.string().uuid().nullable().optional(),
```

### 8. Dialog UX Details

- **No optimistic updates** -- form submits, shows loading, then refreshes page
- **Form sections** are not collapsible (dialog is modal, user chose to edit, show everything)
- **Cancel button** closes dialog without saving, no confirmation needed
- **Close on backdrop click** also cancels without saving
- **Keyboard**: Escape closes dialog, Enter does not submit (Textarea fields need Enter)

### 9. Files Changed Summary

| File | Change |
|---|---|
| `src/app/library/[slug]/page.tsx` | Add edit button, fetch reference data (authors, series, work types) |
| `src/app/library/[slug]/work-edit-dialog.tsx` | New: client component with full edit form |
| `src/lib/actions/works.ts` | Update `updateWork` to handle `workTypeId`, `seriesId` |
| `src/lib/actions/taxonomy.ts` | Add `getWorkTypes()` |
| `src/lib/validations/works.ts` | Add `workTypeId`, `seriesId` to schemas |

## Testing Checklist

- [ ] Edit button visible on work detail page header
- [ ] Dialog opens with all current work data pre-populated correctly
- [ ] Changing title and saving updates the work and slug
- [ ] Changing catalogue status updates correctly
- [ ] Changing acquisition priority updates correctly
- [ ] Changing rating (1-5) works
- [ ] Adding an author via search/select works
- [ ] Creating a new author inline works (findOrCreateAuthor)
- [ ] Removing an author works (except last one -- prevented with toast)
- [ ] Changing author role works
- [ ] Setting work type from dropdown works
- [ ] Setting series from dropdown works, clears seriesName
- [ ] Setting series position works
- [ ] Editing description and notes works
- [ ] Toggling anthology flag works
- [ ] Empty title prevented by validation
- [ ] Loading state shown during save (button disabled + spinner)
- [ ] Toast feedback on success and error
- [ ] Dialog closes after successful save
- [ ] Page refreshes to show updated data
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds

## Completion Notes

[Left empty]

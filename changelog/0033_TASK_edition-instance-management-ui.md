# Task 0033: Edition & Instance Management UI

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0029, 0030
**Blocks**: None

## Overview

Add full CRUD UI for editions and instances on the work detail page. Currently, editions and instances can only be created through the add-book wizard (`src/app/library/new/wizard.tsx`). Once created, they cannot be edited, deleted, or extended from the work detail page -- even though all necessary server actions exist: `updateEdition`, `updateInstance`, `createEdition`, `createInstance`, `deleteEdition`, `deleteInstance` in `src/lib/actions/editions.ts` and `src/lib/actions/instances.ts`.

This task adds:
1. Edit edition metadata via dialog
2. Add new edition to existing work
3. Edition contributor, genre, and tag management
4. Edit instance details via dialog
5. Add new instance to existing edition
6. Delete edition and instance with confirmation
7. Quick instance status changes

## Implementation Details

### 1. Shared Edition Form Component

**New file: `src/components/books/edition-form.tsx`**

Since edition add and edit dialogs share 90% of their form, extract a shared form component:

```typescript
interface EditionFormProps {
  initialValues: Partial<CreateEditionInput>;
  availableAuthors: { id: string; name: string }[];
  availableGenres: { id: string; name: string }[];
  availableTags: { id: string; name: string }[];
  onSubmit: (values: CreateEditionInput) => Promise<void>;
  submitLabel: string;  // "Save" or "Create Edition"
  isPending: boolean;
}
```

Form organized in collapsible sections (matching `InstanceForm` pattern):

**Section 1: Title & Identifiers**
- Title (Input, required)
- Subtitle (Input)
- ISBN-13 (Input, mono font, 13-digit regex validation)
- ISBN-10 (Input)
- Collapsible "More identifiers": ASIN, LCCN, OCLC, Open Library Key, Google Books ID, Goodreads ID

**Section 2: Publication**
- Publisher (Input)
- Imprint (Input)
- Publication Year (Input, number)
- Publication Date (Input, date)
- Publication Country (Input or Select)

**Section 3: Edition Details**
- Edition Name (Input)
- Edition Number (Input, number)
- Printing Number (Input, number)
- Is First Edition (checkbox)
- Is Limited Edition (checkbox)
- Limited Edition Count (Input, number, shown only if `isLimitedEdition`)

**Section 4: Language**
- Language (Select or Input)
- Is Translated (checkbox)

**Section 5: Physical Description**
- Page Count (Input, number)
- Binding (Select from BINDING_TYPES or Input)
- Height mm, Width mm, Depth mm (Inputs, number)
- Weight grams (Input, number)
- Illustration Type (Input)

**Section 6: Content**
- Description (Textarea)
- Table of Contents (Textarea)
- Notes (Textarea)

**Section 7: Cover**
- Cover Source URL (Input, url) -- entering a new URL triggers re-processing on save
- Current cover preview (if editing and cover exists)

**Section 8: Contributors**
- List of current contributors: name, role (Select), remove button (X)
- "Add contributor" button: search input + role selector (translator, editor, illustrator, foreword, introduction, annotator, compiler, narrator)
- Uses `findOrCreateAuthor` for new contributors

**Section 9: Genres & Tags**
- Genre multi-select (reuse `MultiSelectSection` from Task 0032)
- Tag multi-select (reuse `MultiSelectSection`)

**Section 10: Metadata**
- Metadata Locked (checkbox)
- Metadata Source (read-only display if editing)

### 2. Edition Edit Dialog

**New file: `src/app/library/[slug]/edition-edit-dialog.tsx`**

`"use client"` component wrapping the shared `EditionForm`:

```typescript
interface EditionEditDialogProps {
  edition: EditionWithRelations;
  availableAuthors: { id: string; name: string }[];
  availableGenres: { id: string; name: string }[];
  availableTags: { id: string; name: string }[];
}
```

Renders:
- Edit button (Pencil icon, ghost variant, small) on the edition card header
- On click, opens Dialog (`max-w-3xl`, scrollable body)
- Dialog title: "Edit Edition"
- Pre-populates `EditionForm` with existing edition data
- Maps edition's contributors, genres, tags to form initial values
- On submit: calls `updateEdition(edition.id, { ... })`
- Only sends `coverSourceUrl` if it changed (avoids re-processing unchanged covers)
- Toast success/error, `router.refresh()`, close dialog

### 3. Add New Edition Dialog

**New file: `src/app/library/[slug]/edition-add-dialog.tsx`**

`"use client"` component:

```typescript
interface EditionAddDialogProps {
  workId: string;
  workTitle: string;
  availableAuthors: { id: string; name: string }[];
  availableGenres: { id: string; name: string }[];
  availableTags: { id: string; name: string }[];
}
```

Renders:
- "Add edition" button in the Editions section header (Plus icon + "Add edition" text)
- On click, opens Dialog (`max-w-3xl`)
- Dialog title: "Add Edition"
- `EditionForm` with empty initial values (title defaults to work title, workId pre-set)
- On submit: calls `createEdition({ workId, ... })`
- Toast success, `router.refresh()`, close dialog

### 4. Instance Edit Dialog

**New file: `src/app/library/[slug]/instance-edit-dialog.tsx`**

`"use client"` component:

```typescript
interface InstanceEditDialogProps {
  instance: InstanceWithLocation;
  editionId: string;
  availableLocations: LocationWithSubLocations[];
}
```

Renders:
- Edit button (Pencil icon, ghost, small) on the instance row
- On click, opens Dialog (`max-w-2xl`)
- Dialog title: "Edit Instance"
- Wraps the existing `InstanceForm` component (`src/components/books/instance-form.tsx`)
- Pre-populates `InstanceDraft` from existing instance data (mapping DB row to form fields)
- On submit: calls `updateInstance(instance.id, { ... })`
- Toast, refresh, close

**Data mapping from DB to InstanceDraft:**
```typescript
const draft: InstanceDraft = {
  locationId: instance.locationId,
  subLocationId: instance.subLocationId ?? "",
  format: instance.format ?? "",
  condition: instance.condition ?? "",
  acquisitionType: instance.acquisitionType ?? "",
  acquisitionDate: instance.acquisitionDate ?? "",
  acquisitionSource: instance.acquisitionSource ?? "",
  acquisitionPrice: String(instance.acquisitionPrice ?? ""),
  acquisitionCurrency: instance.acquisitionCurrency ?? "",
  isSigned: instance.isSigned,
  signedBy: instance.signedBy ?? "",
  // ... etc for all fields
};
```

### 5. Extend InstanceForm with Status, Lending, and Disposition

**File: `src/components/books/instance-form.tsx`**

The current `InstanceDraft` type and form are missing several fields that are needed for editing existing instances. Add:

**Status section:**
- `status` (Select: available, lent_out, in_transit, in_storage, missing, damaged, deaccessioned)

**Lending section** (shown when `status === "lent_out"`):
- `lentTo` (Input)
- `lentDate` (Input, date)

**Disposition section** (shown when `status === "deaccessioned"`):
- `dispositionType` (Select: sold, donated, gifted, traded, lost, stolen, destroyed, returned, expired)
- `dispositionDate` (Input, date)
- `dispositionTo` (Input)
- `dispositionPrice` (Input, number)
- `dispositionCurrency` (Input, 3 chars max)
- `dispositionNotes` (Textarea)

Update `EMPTY_INSTANCE` constant with defaults for new fields. The add-book wizard defaults status to "available" and hides the lending/disposition sections.

### 6. Add New Instance Dialog

**New file: `src/app/library/[slug]/instance-add-dialog.tsx`**

`"use client"` component:

```typescript
interface InstanceAddDialogProps {
  editionId: string;
  editionTitle: string;
  availableLocations: LocationWithSubLocations[];
}
```

Renders:
- "Add instance" button (Plus icon, ghost, small) on the edition card
- On click, opens Dialog (`max-w-2xl`)
- Dialog title: "Add Instance"
- `InstanceForm` with empty initial values, `editionId` pre-set
- On submit: calls `createInstance({ editionId, ...draft })`
- Toast, refresh, close

### 7. Delete Confirmation Dialog

**New file: `src/app/library/[slug]/delete-confirm-dialog.tsx`**

Reusable `"use client"` component for confirming destructive actions:

```typescript
interface DeleteConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;       // e.g., "Delete edition"
  description: string; // e.g., "Are you sure you want to delete this edition?"
  itemName: string;    // e.g., "Penguin Classics 2003"
  cascade?: string;    // e.g., "This will also delete 3 instances."
}
```

Renders:
- Dialog with warning
- Cascade warning if applicable (e.g., deleting an edition with instances)
- "Cancel" button (secondary variant)
- "Delete" button (red/danger variant)
- Loading state during deletion

For editions: show cascade warning with instance count.
For instances: no cascade, simpler message.

### 8. Quick Instance Status Change

**New file: `src/app/library/[slug]/instance-status-button.tsx`**

`"use client"` component for quick status changes without opening the full edit dialog:

```typescript
interface InstanceStatusButtonProps {
  instanceId: string;
  currentStatus: string;
}
```

Renders:
- Small button showing current status
- On click, shows a popover/dropdown with all available statuses
- Selecting a status calls `updateInstance(instanceId, { status: newStatus })`
- If new status is "lent_out": prompt for `lentTo` via inline input in the dropdown
- If new status is "deaccessioned": redirect to full edit dialog (disposition details needed)
- Toast, refresh

### 9. Action Buttons on Edition Cards

**File: `src/app/library/[slug]/edition-detail-card.tsx`** (from Task 0030)

Add action buttons to each edition card header:

- Edit edition (Pencil icon, ghost)
- Delete edition (Trash2 icon, ghost, red on hover)
- Add instance (Plus icon, ghost)

Buttons are small (h-7 w-7 icon buttons) and appear in the top-right of the card header.

### 10. Action Buttons on Instance Rows

**File: `src/app/library/[slug]/instance-detail.tsx`** (from Task 0030)

Add action buttons to each instance display:

- Edit instance (Pencil icon, ghost, small)
- Delete instance (Trash2 icon, ghost, red on hover, small)
- Quick status change (via `InstanceStatusButton`)

### 11. Data Fetching on Work Detail Page

**File: `src/app/library/[slug]/page.tsx`**

Add `getLocations()` to the parallel fetch (locations needed for instance forms):

```typescript
const [work, ..., allLocations, allGenres, allTags] = await Promise.all([
  getWorkBySlug(slug),
  // ... existing fetches from Tasks 0031 and 0032
  getLocations(),
  getGenres(),  // for edition genre editing
  getTags(),    // for edition tag editing
]);
```

`getLocations()` already exists in `src/lib/actions/locations.ts` and returns locations with sub-locations. `getGenres()` and `getTags()` already exist in `src/lib/actions/taxonomy.ts`.

Pass the reference data to edition/instance action components.

### 12. Files Changed Summary

| File | Change |
|---|---|
| `src/app/library/[slug]/page.tsx` | Fetch locations/genres/tags, add "Add edition" button, pass data to action components |
| `src/app/library/[slug]/edition-detail-card.tsx` | Add action buttons (edit, delete) to edition headers |
| `src/app/library/[slug]/instance-detail.tsx` | Add action buttons (edit, delete, quick status) to instance rows |
| `src/app/library/[slug]/edition-edit-dialog.tsx` | New: edition edit form in dialog |
| `src/app/library/[slug]/edition-add-dialog.tsx` | New: edition creation in dialog |
| `src/app/library/[slug]/instance-edit-dialog.tsx` | New: instance edit form in dialog |
| `src/app/library/[slug]/instance-add-dialog.tsx` | New: instance creation in dialog |
| `src/app/library/[slug]/delete-confirm-dialog.tsx` | New: reusable delete confirmation dialog |
| `src/app/library/[slug]/instance-status-button.tsx` | New: quick status change dropdown |
| `src/components/books/edition-form.tsx` | New: shared edition form component |
| `src/components/books/instance-form.tsx` | Add status, lending, and disposition fields to InstanceDraft and form |

## Testing Checklist

- [ ] Edition edit dialog opens with all current data pre-populated
- [ ] Editing edition title, publisher, ISBN, and saving works
- [ ] Editing edition contributors works (add, remove, change role)
- [ ] Editing edition genres and tags works (multi-select)
- [ ] Changing cover URL triggers cover re-processing
- [ ] Edition physical fields save correctly (page count, dimensions, weight, binding)
- [ ] Add new edition dialog creates edition correctly with workId pre-set
- [ ] New edition appears in editions list after creation
- [ ] Instance edit dialog opens with all current data pre-populated
- [ ] Editing instance location, format, condition saves correctly
- [ ] Editing acquisition details saves correctly
- [ ] Editing collector details (signed, inscription, provenance) saves correctly
- [ ] Instance status change via quick button works
- [ ] Changing status to "lent_out" prompts for lentTo inline
- [ ] Changing status to "deaccessioned" opens full edit dialog
- [ ] Add new instance dialog creates instance with editionId pre-set
- [ ] Delete edition shows confirmation with cascade warning (instance count)
- [ ] Delete edition removes edition and cascaded instances
- [ ] Delete instance shows confirmation dialog
- [ ] Delete instance removes the instance
- [ ] All dialogs show loading state during save (button disabled + spinner)
- [ ] Toast feedback on all operations (success and error)
- [ ] Page refreshes to show updated data after each operation
- [ ] InstanceForm in add-book wizard still works after adding status/lending/disposition fields
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds

## Completion Notes

[Left empty]

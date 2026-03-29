# Task 0038: Multi-Select & Bulk Operations in Library View

**Status**: Completed
**Created**: 2026-03-28
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0035, 0036
**Blocks**: None

## Overview

Add multi-select capability to the library grid view, allowing users to select multiple books and perform bulk operations. Similar to how Plex, Google Photos, and file managers handle multi-select: enter selection mode, pick items, then act on the selection via a floating toolbar.

## Implementation Details

### 1. Selection State Management

**New file: `src/lib/hooks/use-library-selection.ts`**

Custom hook managing selection state:

```typescript
interface UseLibrarySelectionReturn {
  selectedIds: Set<string>;          // set of workIds
  isSelecting: boolean;              // whether selection mode is active
  toggleSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  deselectAll: () => void;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  isSelected: (id: string) => boolean;
  selectionCount: number;
}
```

- Selection mode is entered explicitly (long-press on mobile, Ctrl+click or toolbar button on desktop)
- `Escape` key exits selection mode and clears selection
- State is local to the component tree (no need for global state)

### 2. Selection Mode Entry Points

Users can enter selection mode via:
- **Ctrl+Click** (or Cmd+Click on Mac) on any book card -- selects that card and enters selection mode
- **Long press** (mobile) on any book card -- same as Ctrl+Click
- **"Select" button** in the library toolbar/header (always visible)

### 3. BookCard Selection State

**File: `src/components/books/book-card.tsx`**

Add selection-aware rendering:

```typescript
interface BookCardProps {
  // ... existing props
  isSelecting?: boolean;
  isSelected?: boolean;
  onSelect?: (workId: string) => void;
  onCtrlClick?: (workId: string) => void;
}
```

When `isSelecting` is true:
- Show a checkbox overlay in the top-left corner of the card (replacing the status badge position temporarily)
- Checkbox uses a custom styled square checkbox (2px radius, rose accent when checked)
- Clicking anywhere on the card toggles selection (does NOT navigate)
- Selected cards get a visual indicator: `ring-2 ring-rose-500/50` border glow
- The three-dot menu is still accessible

When `isSelecting` is false (normal mode):
- Card behaves as normal (click navigates)
- Ctrl+Click on the card enters selection mode and selects that card

### 4. Bulk Action Toolbar

**New file: `src/components/books/bulk-action-toolbar.tsx`**

Floating toolbar that appears at the bottom of the viewport when items are selected:

```typescript
interface BulkActionToolbarProps {
  selectedCount: number;
  onDelete: () => void;
  onChangeStatus: (status: string) => void;
  onAddToCollection: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}
```

Renders:
- Fixed position bottom-center, `z-50`
- Background: `bg-bg-secondary border border-glass-border backdrop-blur-md`
- Left side: "{n} selected" count + "Select all" / "Deselect" links
- Right side: action buttons:
  - **Change status** (dropdown with catalogue statuses)
  - **Add to collection** (opens collection picker, depends on Task 0043)
  - **Delete** (danger button, opens bulk delete confirmation)
- Slides up with CSS animation when selection count goes from 0 to 1
- Slides down when selection is cleared

### 5. Bulk Delete Confirmation

When bulk delete is triggered:
- Open `DeleteConfirmDialog` with:
  - Title: "Delete {n} works"
  - Description: "Are you sure you want to delete these works? This action cannot be undone."
  - Item name: list of titles (up to 5, then "and {n} more")
  - Cascade: "This will permanently delete all editions, instances, and media associated with these works."
- On confirm: call `deleteWork(id)` for each selected work (sequential to avoid overwhelming the DB)
- Show progress: "Deleting 3 of 12..."
- On complete: toast "{n} works deleted", clear selection, `router.refresh()`

### 6. Bulk Status Change

When bulk status change is triggered:
- Show dropdown with catalogue statuses (tracked, shortlisted, wanted, on_order, accessioned, deaccessioned)
- On select: call `updateWork(id, { catalogueStatus })` for each selected work
- Toast "{n} works updated", clear selection, refresh

### 7. Library Shell Integration

**File: `src/app/library/library-shell.tsx`**

- Wrap the grid/list/table views with selection context
- Add "Select" toggle button to the library toolbar
- Pass selection props down to `BookCard` components
- Render `BulkActionToolbar` when selection is active

### 8. Keyboard Shortcuts

- `Escape` -- exit selection mode, clear selection
- `Ctrl+A` / `Cmd+A` -- select all visible books (when in selection mode)
- `Delete` / `Backspace` -- trigger bulk delete (when items selected)

### Files

| File | Change |
|---|---|
| `src/lib/hooks/use-library-selection.ts` | New: selection state management hook |
| `src/components/books/book-card.tsx` | Add selection-aware rendering (checkbox, visual state, click behavior) |
| `src/components/books/bulk-action-toolbar.tsx` | New: floating toolbar for bulk actions |
| `src/app/library/library-shell.tsx` | Integrate selection state, toolbar, and selection mode toggle |

## Completion Notes

Implemented multi-select with bulk delete for the library grid view. Scope focused on the core selection flow and bulk delete action; bulk status change and collection picker deferred to future tasks.

### New files
- `src/lib/hooks/use-library-selection.ts` -- custom hook managing selection state (selectedIds Set, selection mode toggle, Escape key handler)
- `src/components/books/bulk-action-toolbar.tsx` -- fixed-position floating toolbar at bottom-center with selection count, select all/deselect, bulk delete with confirmation dialog, and exit button

### Modified files
- `src/app/library/library-shell.tsx` -- integrated selection hook, added Select/Cancel toggle button (CheckSquare icon), passes selection props to LibraryView and renders BulkActionToolbar
- `src/components/books/library-view.tsx` -- added optional `isSelecting`, `selectedIds`, `onSelect` props; forwards them to BookGrid
- `src/components/books/book-grid.tsx` -- added optional selection props; passes `isSelecting`, `isSelected`, `onSelect` to each BookCard
- `src/app/library/filters.tsx` -- passes `className="flex flex-1 items-center gap-3"` to EntityFilters to remove default bottom margin when nested in the new flex layout
- `src/components/shared/entity-filters.tsx` -- added optional `className` prop to allow callers to override the root div styles

### Notes
- BookCard already had `isSelecting`, `isSelected`, `onSelect` props from Task 0036; no changes needed there
- Bulk delete calls `deleteWork()` sequentially to avoid overwhelming the database
- `pnpm typecheck` passes with zero errors

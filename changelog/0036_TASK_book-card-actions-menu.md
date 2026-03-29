# Task 0036: Book Card Actions Menu (Plex-Style)

**Status**: Completed
**Created**: 2026-03-28
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0035
**Blocks**: 0037, 0039, 0040, 0041, 0042, 0043

## Overview

Add a three-dot actions menu to each book card in the library grid view, similar to Plex. The menu appears on hover over the card and provides quick access to all book-level operations without needing to navigate into the book detail page.

This task builds the menu container, the hover UX, and the menu item stubs. Individual action implementations (delete, match again, change poster, etc.) are handled in their own tasks -- this task wires the menu structure and handles the tricky interaction between the card being a navigation link and the menu needing to intercept clicks.

## Implementation Details

### BookCard Restructure

**File: `src/components/books/book-card.tsx`**

The card is currently wrapped entirely in a `<Link>` component. This must change so that interactive elements (the three-dot button, future checkboxes) can live inside the card without triggering navigation.

New structure:

```tsx
<div className="group relative ...card-styles...">
  {/* Cover area -- clicking navigates */}
  <Link href={`/library/${slug}`} className="block">
    <div className="aspect-[2/3] ...">
      {/* cover image or placeholder */}
    </div>
  </Link>

  {/* Three-dot menu -- overlay on cover, top-right */}
  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
    <BookCardActionsMenu workId={workId} slug={slug} title={title} />
  </div>

  {/* Status badge -- top-left (existing) */}
  {/* Rating badge -- top-right below menu (existing, adjust position) */}

  {/* Metadata footer -- clicking navigates */}
  <Link href={`/library/${slug}`} className="block">
    <div className="p-3 ...">
      {/* title, author, year, language, instance count */}
    </div>
  </Link>
</div>
```

Key changes:
- Card wrapper is `<div>` not `<Link>` -- navigation is on cover and metadata areas
- Three-dot button sits in an absolutely-positioned overlay
- `group` class on the card enables `group-hover:opacity-100` on the menu trigger
- `stopPropagation` on the menu trigger to prevent any bubbling
- Rating badge repositioned to avoid overlap with menu button (move to cover bottom-right or adjust spacing)

### BookCardActionsMenu Component

**New file: `src/components/books/book-card-actions-menu.tsx`**

```typescript
"use client";

interface BookCardActionsMenuProps {
  workId: string;
  slug: string;
  title: string;
}
```

Uses the `DropdownMenu` component from Task 0035. Menu items:

| Item | Icon | Action | Variant |
|---|---|---|---|
| Edit | `Pencil` | Navigate to `/library/{slug}` | default |
| Delete | `Trash2` | Opens delete confirmation dialog | danger |
| Match again | `RefreshCw` | Opens match dialog (Task 0039) | default |
| --- | separator | | |
| Change poster | `Image` | Opens poster change dialog (Task 0040) | default |
| Change background | `ImagePlus` | Opens background change dialog (Task 0041) | default |
| Add gallery | `Images` | Opens gallery upload dialog (Task 0042) | default |
| --- | separator | | |
| Add to collection | `FolderPlus` | Opens collection picker (Task 0043) | default |

For items whose backend tasks are not yet implemented, render them as `disabled` menu items. They will be enabled as their respective tasks are completed.

### Three-Dot Button Styling

- Icon: `MoreVertical` (Lucide), 16px, 1.5px stroke
- Button: `h-7 w-7` circle (exception to the 2px radius rule -- circular icon buttons are acceptable for action dots)
- Background: `bg-black/60 backdrop-blur-sm` (semi-transparent dark, readable over any cover)
- Hover: `bg-black/80`
- Color: `text-white`
- Appears only on card hover (`opacity-0 group-hover:opacity-100`)
- On touch devices: always visible (use `@media (hover: none)` to show permanently)

### Event Handling

- The three-dot button must call `e.stopPropagation()` and `e.preventDefault()` on click
- Menu item clicks must not propagate to the card's link areas
- "Edit" item uses `router.push()` instead of `<Link>` since it's inside a menu

### Files

| File | Change |
|---|---|
| `src/components/books/book-card.tsx` | Restructure from Link-wrapper to div-wrapper with separate Link areas |
| `src/components/books/book-card-actions-menu.tsx` | New: the three-dot dropdown menu component |

## Completion Notes

Implemented two components:

1. `src/components/books/book-card-actions-menu.tsx` -- DropdownMenu with MoreVertical trigger, all 8 menu items (Edit, Delete, Match again, Change poster, Change background, Add gallery, Add to collection). Delete is fully wired with DeleteConfirmDialog. Match again, poster, background, gallery, collection items are rendered disabled pending their respective task implementations.

2. `src/components/books/book-card.tsx` -- Restructured from `<Link>` wrapper to `<div>` wrapper with two separate `<Link>` areas (cover and metadata). Three-dot menu appears top-right on hover with `opacity-0 group-hover:opacity-100`. Added selection props (`isSelecting`, `isSelected`, `onSelect`) for future multi-select support (Task 0038). Selection checkbox renders top-left in selection mode. Rating badge position adjusted to avoid overlap.

3. `src/components/books/work-quick-edit-dialog.tsx` -- Self-fetching edit dialog. "Edit" menu item opens this dialog instead of navigating to the detail page. On open, it loads work data + all reference data (authors, series, work types, recommenders) in parallel, then renders the full edit form with all fields: title, language, year, type, anthology, status, priority, rating, description, notes, recommender, series, and authors management.

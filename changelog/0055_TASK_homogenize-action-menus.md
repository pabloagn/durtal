# Task 0055: Unified Entity Action Menu (Authors and Books)

**Status**: Completed
**Created**: 2026-03-30
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: 0054, 0056

## Overview
Replace all scattered action buttons on both author and book detail pages with a single, beautiful action button per entity page. Clicking it opens a dropdown submenu with all available actions. This creates a clean, non-invasive UI where the content (gallery, taxonomy, metadata) is free of edit buttons.

## Current State

### Author detail page (4 header buttons + inline media uploads)
- Media (opens media manager dialog)
- Merge (opens merge dialog)
- Edit (opens edit dialog)
- Delete (opens confirmation)
- Plus: inline upload zones in media section (poster, background, gallery)

### Book detail page (scattered across sections)
- Copy, Edit Work, Delete Work (header)
- Edit Taxonomy (taxonomy section header)
- Manage Media (media section header)
- Add Edition (editions section header)
- Per-edition: Match Again, Edit Edition, Add Instance, Delete Edition
- Per-instance: Status dropdown, Edit Instance, Delete Instance

## Target State

### Author detail page: ONE button (top-right of header area)
A single prominent action button with dropdown submenu:
1. **Copy** -- copies "First Name Last Name" to clipboard
2. **Merge** -- opens AuthorMergeDialog
3. **Edit** -- opens AuthorEditDialog
4. **Manage Media** -- opens AuthorMediaManagerDialog (with monochrome controls, B&W conversion, contrast/brightness/gamma/sharpness)
5. **Delete** -- opens delete confirmation (destructive, visually separated)

The author detail page content areas (gallery, bio, works list) become completely clean -- no inline edit buttons or upload zones. The gallery section shows the collage grid (Task 0057) as read-only display.

### Book detail page: ONE button (top-right of header area)
A single prominent action button with dropdown submenu:
1. **Copy** -- copies "Title, Author Name" to clipboard
2. **Edit Work** -- opens WorkEditDialog
3. **Edit Taxonomy** -- opens WorkTaxonomyEditDialog (removed from taxonomy section header)
4. **Manage Media** -- opens MediaManagerDialog (removed from media section header)
5. **Add Edition** -- opens EditionAddDialog (removed from editions section header)
6. **Delete Work** -- opens delete confirmation (destructive, visually separated)

Per-edition and per-instance actions remain inline (they are contextual to specific sub-entities and can't be consolidated into the top-level menu). But they should be visually cleaned up to match the new design language.

## Implementation Details

### Action button design
- Single button, positioned exactly where the current scattered buttons sit (top-right of the detail page header)
- Must be beautiful and prominent but not interruptive -- it replaces the existing button cluster, not adds to it
- Gothic-minimal aesthetic: muted colors, 2px border radius, subtle glassmorphism or border treatment
- The button itself should feel like a natural part of the header, not an afterthought
- Icon recommendation: a subtle horizontal ellipsis or a pen-square icon -- whichever integrates most cleanly with the header typography
- On click: opens a dropdown menu with all actions listed
- Destructive actions (Delete) visually separated at the bottom (divider + muted red text)
- Menu items should have clear icons (Lucide) and labels
- Smooth open/close animation (fade + slight scale)

### Sections to clean up
- **Author page**: Remove `AuthorMediaSection` inline upload areas from main view entirely
- **Book page**: Remove "Edit Taxonomy" button from taxonomy section header
- **Book page**: Remove "Manage Media" button from media section header
- **Book page**: Remove "Add Edition" button from editions section header (move to dropdown)
- Both pages: Remove individual Copy/Edit/Delete buttons from headers

### What stays inline
- Per-edition action buttons (contextual to each edition card)
- Per-instance action buttons (contextual to each instance row)
- These are sub-entity actions, not page-level actions

# Task 0077: Dialog Linear-Style Polish and Size Increase

**Status**: Completed
**Created**: 2026-03-31
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: 0076

## Overview
Increase the default width and height of all data-editing dialogs and polish the overall dialog UX to match the Linear.app editing experience.

## Implementation Details

### Base Dialog component (`src/components/ui/dialog.tsx`)
- Default width: `max-w-lg` (512px) -> `max-w-2xl` (672px)
- Border radius: `rounded-sm` (2px) -> `rounded-md` (4px)
- Background: `glass-surface` -> `bg-bg-secondary` with `border border-glass-border`
- Shadow: enhanced to include subtle rose accent glow
- Backdrop: `bg-bg-primary/70` -> `bg-black/60` with `backdrop-blur-lg`
- Header padding: `px-5 py-3.5` -> `px-6 py-4`
- Header title: `text-xl` -> `text-2xl`
- Header description: `text-xs` -> `text-sm`
- Close button: `p-1` -> `p-1.5` for larger hit area
- Body padding: `p-5` -> `px-6 pb-6 pt-5`
- Added entrance animation: `dialog-scale-in` (scale 0.97 -> 1 + fade, 150ms ease-out)

### Size tier assignments across all 21 dialogs
- **Small** (`max-w-lg`, `expandable={false}`): DeleteConfirmDialog, Location Delete
- **Medium** (`max-w-2xl`, default): Author Create/Edit/Merge, Work Edit/Quick Edit, Instance Add/Edit, Location Create/Edit, Collection Create, Venue Create, Add to Collection, Match Again
- **Large** (`max-w-3xl`): Work Media Manager, Author Media Manager, Taxonomy Edit, Edition Add/Edit, Order Create

### Scroll area standardization
- All `max-h-[70vh]` and `max-h-[72vh]` inner scroll areas -> `max-h-[75vh]`

### CSS additions (`src/styles/globals.css`)
- Added `.dialog-enter` animation class
- Added `@keyframes dialog-scale-in` (scale + opacity transition)

### Files modified
- `src/components/ui/dialog.tsx`
- `src/styles/globals.css`
- `src/app/library/[slug]/delete-confirm-dialog.tsx`
- `src/app/library/[slug]/work-edit-dialog.tsx`
- `src/app/library/[slug]/work-taxonomy-edit-dialog.tsx`
- `src/app/library/[slug]/edition-edit-dialog.tsx`
- `src/app/library/[slug]/edition-add-dialog.tsx`
- `src/app/library/[slug]/instance-edit-dialog.tsx`
- `src/app/library/[slug]/instance-add-dialog.tsx`
- `src/app/locations/location-card.tsx`
- `src/app/provenance/order-create-dialog.tsx`
- `src/app/collections/create-collection-dialog.tsx`
- `src/app/places/venue-create-dialog.tsx`
- `src/app/authors/author-create-dialog.tsx`
- `src/app/authors/[slug]/author-edit-dialog.tsx`
- `src/components/books/work-quick-edit-dialog.tsx`
- `src/components/books/match-again-dialog.tsx`

## Completion Notes
All 21 dialog instances updated. Typecheck passes clean. Dialogs are now wider, more spacious, with proper entrance animations and consistent sizing tiers.

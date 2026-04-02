# Task 0087: Inline Book Creation from Order Dialog

**Status**: Completed
**Created**: 2026-04-01
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0060, 0024
**Blocks**: None

## Overview
When creating a new order, the user must select an existing work from the library. If the book is not yet in the library (common scenario: ordering a book you don't own yet), the user has to abandon the order dialog, navigate to the library, create the work there, come back to provenance, and start over. This is unacceptable. Add the ability to create a new work inline from within the order creation dialog, so the full pipeline stays uninterrupted.

## Requirements

### Inline Work Creation
- In Step 1 of the order create dialog (work search), when the search returns no results or the desired work is not found, show an "Add New Work" button/link below the search results
- Clicking "Add New Work" opens a nested dialog (or expands an inline form) with the minimal fields needed to create a work:
  - Title (required)
  - Primary author name (required) -- with autocomplete against existing authors, plus option to create new author inline
  - Original language (optional, dropdown)
  - Original year (optional)
- On submit, calls `createWork` server action (from `src/lib/actions/works.ts`)
- The newly created work is automatically selected in the order dialog and the user continues to Step 2
- The work is created with `catalogueStatus: 'on_radar'` or `'wishlist'` (not 'catalogued', since it's being ordered, not yet owned)

### Inline Author Creation
- If the author typed in the "Primary author" field doesn't match any existing author, show "Create author: [name]" option in the autocomplete dropdown
- Creates the author with just the name (minimal entry) via `createAuthor` server action
- Links the new author to the new work via `work_authors`

### UX Flow
1. User opens "New Order" dialog
2. Searches for a work -- not found
3. Clicks "Add New Work"
4. Fills in title + author (2 fields minimum)
5. Submits -- work created, auto-selected
6. Continues with order creation Steps 2-4 as normal

### Constraints
- The inline form must be minimal -- this is not the full "Add Book" wizard (Task 0024). Just enough to get a work record into the system so the order can reference it
- The work can be enriched later from the library page
- If the dialog is cancelled after creating the work, the work persists (it was already saved) -- this is fine, the user can find it in the library later

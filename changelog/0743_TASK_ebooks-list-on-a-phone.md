# Task 0743: The eBooks list on a phone (SLN-799)

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Design polish pass 3, item 2 (`findings/design-polish-3-2026-10-15.md`). In list view at 390 the eBooks table was wider than the screen and scrolled sideways, cutting authors at the edge. "Read" ran into the title with no space ("The Broken SealRead"), and the sort headers were 31px tall on touch, the pass's one audit failure.

## Implementation Details
- `src/components/ebooks/ebook-row.tsx`: the title cell is a row of the title and Read, with Read on the title's first line through `CapAligned` (32px, 44px on touch) and labelled "Read <title>". Where the columns would not fit, the cell also shows the author, then formats and size (and the linked mark), and every other column hides, so the table is the cover and one wrapping column.
- `src/app/(catalogue)/ebooks/ebooks-view.tsx`: the list's wrapper is a size container. The full table needs about 813px (measured in Chromium, Firefox and WebKit), so under 52rem (832px) of list width the rows stack and the header row hides; the sort row above the list sorts, as in the grid. That covers a phone and also a tablet or a 1024px window beside the sidebar, where the table used to scroll sideways by 49 to 205px. Where the table stays, its sort buttons are 44px tall on touch.
- Test: `src/__tests__/ui/ebooks-list-phone.test.ts`.

## Completion Notes
One table for every width, so the page carries no second copy of the list.

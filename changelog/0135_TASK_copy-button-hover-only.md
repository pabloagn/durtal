# Task 0135: Copy button on book covers shows only on hover

**Status**: Completed
**Created**: 2026-09-26
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0130
**Blocks**: None

## Overview

SLN-324: The copy-title-and-author button from task 0130 was always visible on each book cover in the library grid. The three-dot menu beside it shows only on hover, so the permanent button looked out of place.

## Implementation Details

- `src/components/books/book-card.tsx`: the copy button wrapper uses the same `opacity-0 group-hover:opacity-100` pattern as the three-dot menu.
- `focus-within:opacity-100` keeps the button visible when it has keyboard focus.
- List rows, the data table and the book page header are unchanged.

## Completion Notes

Browser check on a disposable preview: both cards report opacity 0 at rest; the hovered card shows the copy button and the menu together. No data or schema change.

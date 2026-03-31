# Task 0073: Timeline Sorting Respects All Sort Modes

**Status**: Completed
**Created**: 2026-03-31
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Timeline view sorting was hardcoded to birth year ascending. All sorting filters (name, last name, recent, born, works) now work in the timeline view, matching the behavior of grid/list/detailed views.

## Implementation Details
- Modified `src/components/timeline/author-timeline.tsx`
  - Added `TimelineSortKey` type and `sortBy`/`sortOrder` props to `AuthorTimelineProps`
  - Replaced hardcoded `.sort((a, b) => a.birthYear - b.birthYear)` with a switch-based sorter
  - Supports: `name` (alphabetical), `lastName` (by extracted last name), `birth` (by birth year), `works` (by works count), `recent` (by birth year descending)
  - Respects ascending/descending order
- Modified `src/app/authors/authors-shell.tsx`
  - Passes `sortBy` and `sortOrder` from URL search params to the `AuthorTimeline` component

## Completion Notes
Changing the sort option in the toolbar now reorders the timeline bars accordingly. For example, sorting by "Works" arranges authors by their works count, and sorting by "Name" arranges them alphabetically.

# Task 0082: Grid Size Slider Live Update Fix

**Status**: Completed
**Created**: 2026-04-01
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
The "Size" slider in the Library view (grid column count) required a full page refresh for changes to take effect. Moving the slider updated `localStorage` but the grid component did not re-render.

## Root Cause
`LibraryFiltersBar` and `LibraryShell` each instantiate their own `useLocalStorage` hook for the same keys (`durtal-grid-columns`, `durtal-view-mode`). When the slider calls `setValue`, it updates `localStorage` and the filter bar's own React state, but the shell's independent hook instance never receives the update. The native `storage` event only fires across browser tabs, not within the same tab.

## Implementation Details
Modified `src/lib/hooks/use-local-storage.ts` to dispatch a custom DOM event (`durtal-local-storage`) whenever `setValue` writes to `localStorage`. All hook instances listen for this event and update their React state when the matching key changes. This keeps every consumer of the same `localStorage` key in sync without requiring a shared context or component restructuring.

### Files Modified
- `src/lib/hooks/use-local-storage.ts` -- Added `CustomEvent` dispatch on write and event listener on mount for same-tab cross-instance synchronization.

## Completion Notes
Single-file fix. No new dependencies. The same synchronization now applies to all `useLocalStorage` consumers (view mode, grid columns, sidebar width, etc.).

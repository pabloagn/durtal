# Task 0752: Book import says plainly it isn't available yet

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-832. Design polish pass 4, item 4 (`findings/design-polish-4-2026-10-15.md`).

The dashboard's second button, "Import books", opened /library/import, the dead end most often reached in the pass. It showed a "CSV Import" card ("Coming soon — use Python ingestion scripts for now"), a card of developer commands (`task ingest:dry`, `task ingest` from `scripts/ingest/`) and an empty "Import history". The tab said "Import Books" over a page titled "Import".

## Implementation Details
- Dashboard (`src/app/(catalogue)/page.tsx`): the header offers Add book only. No Import until importing books exists.
- Command palette: the "Import books" action is gone.
- `/library/import` stays reachable by its address. It is one empty state, "Importing books isn't available yet", with what works today: Add book, and Import reading history (`/reading/import`). No developer commands, no "Coming soon", no empty history. The tab reads "Import", as the page does.
- Docs: `docs/04_ROUTES_AND_VIEWS.md` (route list, palette, dashboard header, the import page).
- Test: `src/__tests__/ui/import-not-yet.test.ts`.

## Completion Notes
See the PR's checks.

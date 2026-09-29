# Task 0153: Alphabetical Work Cards

**Status**: Completed
**Created**: 2026-09-29
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Linear: [SLN-344](https://linear.app/sanctum-black/issue/SLN-344/always-sort-author-works-and-browsing-card-views-alphabetically).

Author works and ordinary browsing cards use ascending title order. Numbered volumes compare naturally, with case and accents ignored and stable IDs breaking title ties. Explicit sort choices, recent/ranked sections, series reading order, and collection manual order retain their existing behavior.

## Implementation Details

- Share title comparison across author lookups, library browsing, taxonomy, recommenders, publishers, reader cards, More by, mark rows, and the dashboard wishlist.
- Sort the full matching set before pagination/truncation. Database-paginated views first fetch lightweight IDs/titles, then load details only for the selected page.
- Default the library and its visible sort control to Title.
- Align the recommender action menu with its heading after the browser audit exposed an existing offset.

## Completion Notes

- Confirmed Solvej Balle's five volumes render as 1, 2, 3, 4, 5 locally.
- Added 3 comparator tests and 8 PostgreSQL integration tests for author lists, page boundaries, numeric volumes, equivalent titles, filtering, carousel limits, publishers, recommenders, reader cards, wishlist cards, and explicit sort preservation.
- Test suite: 452 passed; 120 unrelated database tests skipped without their opt-in database URLs.
- Final `pnpm typecheck` passed; browser alignment audits passed for author, library, work, publisher, recommender, reader, dashboard, and taxonomy pages.
- Active on the running Durtal instance at `http://localhost:3100` (the existing Next.js service serves this checkout). Author ordering and the default library title sort were reverified in the running app. The sorting fix is committed on the active `fix/backlog-0116-0121` branch; unrelated in-progress changes remain separate.

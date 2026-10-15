# Task 0756: Every search palette row shows whole, and the e-book keys show on the selected row only

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-849. Design polish pass 5, item 3 (`findings/design-polish-5-2026-10-15.md`).

- Organization results were cut at every width ("Seed Organization 1 · Perfume house · Museum · M…"), though the roles are the identifying line.
- On a phone other rows were cut: "Continue reading The Six Pa…", "Add a recommender" at 320, "Search perfumes for “settings”". Book rows already wrapped there.
- The placeholder was cut at 320.
- "Read ⌃↵" showed on every book row with an e-book, five times in one list, though the keys only act on the selected row.

## Implementation Details
- `src/components/layout/command-palette.tsx`:
  - Every row's words wrap in full at every width (`LABEL_CLASS`), as book rows did on a phone.
  - On a phone a person's, organization's or place's roles go on a second line, as a book's authors do. The " · " before them is held to the name, so a wrapped line never starts with it.
  - A row's icon sits on the cap height of its first line (`RowIcon`, through `CapAligned`), so a row that wraps keeps its icon beside its first words.
  - A shorter placeholder below 640px: "Search, or type a command…".
- `src/components/ebooks/catalogue-read-action.tsx`: "Read" stays a button on every row, but its ⌘↵ keys show only on the selected row (and never on a phone).

## Completion Notes
See the PR for the browser checks.

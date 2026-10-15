# Task 0618: A palette search that fails says so

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

From the second loading audit of 15 October
(`findings/audit-loading-2-2026-10-15.md`, finding 4; SLN-752). When the
catalogue could not be searched, the command palette showed only its "Search
books for ..." rows, with no matches and no word that the search had failed.
Its spinner while searching had no label for a screen reader.

## Implementation Details

`src/components/layout/command-palette.tsx`:
- A failed search shows a "Search failed" group: "The catalogue could not be
  searched." (a status), and a "Search again" item that runs the same search
  again. The field keeps the focus, so typing goes on.
- A new search, or a field under two letters, clears the failure.
- The spinner is a status reading "Searching".

## Completion Notes

- Production preview with every query failing, Chromium, Firefox and WebKit:
  typing "huys" shows the failure and Search again; with the database back,
  Search again shows the matches.
- `src/__tests__/ui/palette-search-failure.test.ts`: the failure and Search
  again, clearing it, and the spinner's label.

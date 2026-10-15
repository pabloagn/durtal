# Task 0657: A publisher with nothing in the catalogue shows no row of zeros

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Design-polish pass of 15 Oct (findings/design-polish-2026-10-15.md, item 7).
A publisher with no books showed "0 books" under its name and "Books (0)"
over the empty state. Its side panel also listed Books 0, Editions 0,
Owned 0, Read 0, Wanted 0 and On order 0.

## Implementation Details

- `src/app/(catalogue)/publishers/[slug]/page.tsx`: the "In the catalogue"
  group shows only when one of its counts is above zero (docs/03: a group
  with nothing to show is left out). The Details and Links groups are
  unchanged. With any count above zero the group is exactly as before.
- Test: `src/__tests__/ui/publisher-empty-counts.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database against
  main, Gallimard (no books), in Chromium, Firefox and WebKit at 1440 and
  390 (touch at 390 except Firefox).
  - The panel holds only Links.
  - The header still says "0 books", and the Books section shows its
    empty state.
  - Alignment, overflow and layout audits are clean.
- The seed has no publisher with books, so the case with counts was not
  seen in a browser. Its markup is unchanged; only the condition is new.
- `page-weight.js` passes. Typecheck clean; lint has no new warnings. No migration, no new
  package.

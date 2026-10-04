# Task 0301: Go to Books is G B

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-440. The Go to menu opened Books with `G L` ("Go Library"). It is now
`G B`, like the Add menu's `A B` for a book.

## Implementation Details

- `src/lib/catalogue/domains.ts`: the book domain's `keys.go` is `b`. The Go
  to menu, the shortcut sheet (`?`) and the command palette hints all read
  `GO_TO`, so they follow.
- `B` was free in the Go to menu (Dashboard D, Perfumes E, Films F, Paintings
  I, Authors A, Publishers P, Series S, Collections C, Provenance O, Places M,
  Taxonomy T, Harmonize H, Reader R, Settings ,). `domain-navigation.test.ts`
  checks that every Go key stays unique.
- `docs/04_ROUTES_AND_VIEWS.md` and two comments say `G B`.

## Completion Notes

`L` is now free in the Go to menu.

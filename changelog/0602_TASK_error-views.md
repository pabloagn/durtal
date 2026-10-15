# Task 0602: Error views: one shared view, a way back, a record's own words

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-700, piece D of the SLN-641 slice 3 audit. Pages that reached the
catalogue's root error view (a publisher, Reading) got a hand-made "Try
again" 38px tall on touch, with no way back; Harmonize's error had another.
A failing film page said "Films could not be loaded." and led to the
dashboard. A failing book or film page left the tab with no title.

## Implementation Details

- `(catalogue)/error.tsx` and `harmonize/error.tsx` render `SectionError`:
  the shared `Button` for Try again (44px on touch) and "Go to the
  dashboard". Harmonize keeps its own words ("The catalogue scan was
  interrupted. Your records are unchanged…").
- `SectionError` renders `<title>Something went wrong | Durtal</title>`, so
  a page that fails before it is sent (a book, a film, Reading: a 500) names
  the tab. A page that fails while it streams (the books, films and people
  lists, a publisher) was already sent with its own title, and Next writes
  that title again after the error view mounts, so the tab keeps the page's
  name.
- `EmptyState` takes `tone="error"`: the same block with its icon in
  `accent-red-text` (contract section 8, "Errors use the same block as empty
  states, in accent-red-text"). `SectionError` uses it.
- `DomainError` takes `record`: "This film could not be loaded." and "Back to
  films". `library/[slug]`, `films/[slug]`, `paintings/[slug]` and
  `perfumes/[slug]` get an `error.tsx` that uses it.
- `src/__tests__/ui/error-views.test.ts` pins the wording, the way back, the
  title and the error files.

## Completion Notes

Measured on a disposable preview with the `works` table renamed for the pass:
see the PR.

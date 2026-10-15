# Task 0603: Not-found views agree, inside the app shell

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-701, piece E of the SLN-641 slice 3 audit. Not-found views came in three
shapes. A missing film or publisher said "Film not found" with a way back to
its list; a missing book or person said "Page not found" with a hand-styled
"Go to dashboard" link; a missing top-level address had no icon and no app
shell, so no menu to leave by.

## Implementation Details

- `library/not-found.tsx` ("Book not found", "Back to books") and
  `people/not-found.tsx` ("Person not found", "Back to people") take the
  films' shape: `EmptyState` with a reason and a shared ghost Button link.
  Each sets the tab's title.
- `(catalogue)/not-found.tsx` is the same block: "Page not found", "Go to the
  dashboard" as a shared Button link.
- `(catalogue)/[...missing]/page.tsx` catches every address no other page
  matches and calls `notFound()`, so a mistyped address shows the catalogue's
  not-found view inside the app shell, with its menu, and answers 404.
  `global-not-found.tsx` stays the fallback when the shell itself cannot
  render. With every address now a page, ESLint's
  `no-html-link-for-pages` flags the add-book wizard's plain `<a>` to
  `/locations`; it becomes a `Link`.
- Every collection's not-found view sets the tab's title ("Film not found |
  Durtal"); the film, perfume, painting, publisher and organization ones had
  none.

## Completion Notes

Measured on a disposable preview: see the PR.

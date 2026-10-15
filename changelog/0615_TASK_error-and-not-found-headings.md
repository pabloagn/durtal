# Task 0615: Error and not-found views have the page's h1 and a real way back

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0612
**Blocks**: None

## Overview

From the loading, empty and error states audit of 15 October
(`findings/audit-loading-2026-10-15.md`, finding 11), and the review of #325.

- **No main heading.** An error view's "Something went wrong" was an h3. While
  a page was in error, it had no h1. A not-found view ("Person not found") was
  the same.
- **The way back read as text.** An error view's "Back to ..." was a ghost
  link, the plain-text look #315 and #325 removed from the not-found and
  no-results views.

## Implementation Details

- `EmptyState` (`src/components/ui/empty-state.tsx`) takes `heading`: `h1`
  for a view that is the whole page, `h3` (as before) everywhere else. The look
  is the same.
- `SectionError` uses `h1`. It is every section's error view, and a failed
  page shows only it: an error under the settings layout falls to the
  catalogue's own error view, outside that layout's title.
- The eight not-found views of the catalogue use `h1`.
- `SectionError`'s way back is `buttonClass("secondary")`.

## Completion Notes

- `src/__tests__/ui/loading-audit-states.test.ts`: the error view's h1 and
  secondary way back, a not-found view's h1, and the shared empty view's h3
  elsewhere.
- Production preview, Chromium, Firefox and WebKit at 1440, 390 and 320: the
  alignment, touch, design and layout audits report nothing on:
  - a missing person, a missing book and a missing page;
  - the publishers and a person with every query failing.

# Task 0614: The dashboard loads in its own layout

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

From the loading, empty and error states audit of 15 October
(`findings/audit-loading-2026-10-15.md`, finding 10). While the dashboard
loaded, it showed a lone spinner under its title, which the page's sections
then replaced.

## Implementation Details

- `src/app/(catalogue)/page.tsx`: the Books section is its own `BookCounts`,
  drawn by the page and by its loading view.
- While the dashboard loads (`role="status"`, "Loading the dashboard"):
  - the section heading, the four count cards with their marks and labels, and
    the two book actions are drawn as on the page;
  - only the counts are held, as `SkeletonLine`s of the stat type.
- The sections below appear under it when the page arrives.
- It is built from the page's own parts and the shared skeleton, so the
  dashboard revamp (SLN-740) can drop it with no other change.

## Completion Notes

- Production preview, database slowed to 1.5 s a query, Chromium, Firefox and
  WebKit at 1440, 390 and 320:
  - The title, section heading, cards, labels and actions measure 0 px against
    the page.
  - The counts' lines hold their height: 0 px.
- The alignment, touch, design and layout audits report nothing on the loading
  view and on the page.
- Page weight: `/` 138 of 300 KB.

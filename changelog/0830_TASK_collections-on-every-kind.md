# Task 0830: Films, perfumes and paintings link back to their collections

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-916, from the series and collections survey
(findings/series-collections-survey-2026-10-16.md, item 5). A book page has a
Collections section; a film, perfume or painting in a collection had no link
back to it.

## Implementation Details

- `src/components/collections/work-collections.tsx`: `loadWorkCollections`
  (the collections holding a work, and the member covers of those without a
  poster) and `WorkCollectionsSection` (the carousel of collection cards,
  nothing when there are none), from the book page's section.
- The book page renders its section through it, with its footer naming the
  editions held. Film and perfume pages show it after their related row, as
  the book page shows it after its author row; a painting page after its
  gallery. Each page loads it beside its other reads.

## Completion Notes

- A film in two collections, a perfume and a painting in one each link to
  them; a film in none shows no section; the book page is unchanged.
- Audits clean on those pages and a book page in Chromium, Firefox and WebKit
  at 1440, 390 and 320; page weight passes. The section adds about 8 KB to a
  film page with two collections (the large seed's film page: 297 KB).

# Task 0692: The book page reads in fewer rounds

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-794, from the speed survey (`findings/speed-survey-2026-10-15.md`, item
1). A book's page waited on the database 8 to 10 times in a row: after its
main reads, the e-book availability, the e-book marks, the place in Up Next,
the reading estimates, the prediction gate and its context, and the
collection covers each waited for the one before. Then the gallery and the
record's custom families started only when the page rendered, and the
gallery read its images and then its layout.

## Implementation Details

- `src/app/(catalogue)/library/[slug]/page.tsx`:
  - The reading day's start hour, the place in Up Next and the prediction
    gate join the main reads.
  - What needs those reads goes out together: the e-book availability (then
    the e-book marks, which need it), the reading estimates, the prediction
    context (only for an unread book with the gate on, as before) and the
    collection covers.
  - The gallery's and the custom families' reads start as soon as the book
    is found.
- `src/components/shared/gallery-section.tsx`: `preloadGallery(type, id)`
  starts the gallery's reads early; the section renders from the same read
  (React `cache`, once per request).
- `src/lib/actions/gallery-layouts.ts`: `getGalleryWithLayout` reads the
  images and the stored layout side by side. The person, film, perfume and
  painting pages get this too.
- `work-taxonomy-section.tsx`: `workTaxonomyAssignments(workId)`, the
  record's custom families once per request, which the page starts early.

## Completion Notes

Production build, local preview from one database dump (synthetic catalogue,
reader fixtures, 20 demo books, the reading journey, a 3-image gallery). Each
HTTP request to the database held 40 ms or 200 ms (one Neon round trip);
five books (an open reading, a finished one, an e-book, a gallery, one in a
collection), each run twice:

| `/library/[slug]` | Rounds | 40 ms | 200 ms |
| --- | --- | --- | --- |
| main | 7-10 | 0.44-0.51 s | 1.68-2.11 s |
| this change | 3-5 | 0.24-0.35 s | 0.89-1.11 s |

Requests stay at 21-23 (no batching). The rendered page, after streaming,
is the same as main's for all five books (the body's HTML compared, with
ids, cache-busting numbers and React's generated ids normalised).

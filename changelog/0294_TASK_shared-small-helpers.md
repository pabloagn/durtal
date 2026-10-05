# Task 0294: Small Helpers in One Place (SLN-305)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-305: small helpers written again in many files instead of imported, so a change (a CDN for images, SLN-295) must be made in every copy. Most of the list is already done on main; this task does the free part of the rest. Files that open PRs change wait for those PRs (see Not changed).

## Implementation Details

Already done on main before this task:

- `UUID_RE` / `isUuid`: one definition in `src/lib/utils/uuid.ts` (task 0289); `src/lib/api/rest.ts` re-exports it.
- Venue type labels: one `VENUE_TYPE_LABELS` in `src/lib/catalogue/venues.ts`.
- `slugify`: one definition in `src/lib/utils/slugify.ts`; the taxonomy family copy went with task 0291.
- `getPosterUrl` and `getAuthorName` in provenance: one copy each in `src/app/provenance/order-model.ts` with SLN-302 (task 0293).

This task:

- **Image URLs**: the image route's address was built by hand (`/api/s3/read?key=${encodeURIComponent(key)}`) in 17 files with no open PR. They now call `mediaUrl(key)` from `src/lib/s3/media-url.ts`, which already built the versioned and resized URLs. That includes `s3ImageSource` (image adjustments), the poster, painting and perfume image helpers, the domain homes, the gallery, the two media managers, the comment attachments, the publisher logos, Harmonize, series and the match and timeline actions. The gallery's `getImageUrl` callback is now `mediaUrl` itself.
- **File sizes**: the comment attachment list had its own `formatFileSize`; it now uses `src/lib/utils/format.ts`. A size that is a whole number now shows without ".0" ("2 KB", not "2.0 KB"), as everywhere else.

`mediaUrl` encodes the key with `URLSearchParams`, the hand-built copies with `encodeURIComponent`. They differ only for a space and a few punctuation marks, which stored keys do not have; the route reads the key with `searchParams.get` either way, and image adjustments find their image by the key, not the URL text.

## Completion Notes

- Every image URL the app puts on 13 pages (`/`, `/library`, `/publishers`, `/perfumes`, `/films`, `/paintings`, `/series`, `/authors`, `/collections` and the first detail page of books, perfumes, films, series, authors and publishers), read in a browser on main and on this branch with the same disposable data: 525 distinct URLs, the same on both. The only differing URLs carry the book card's retry marker (`_r=N`, added when an image fails to load in the preview), which depends on timing.
- Alignment and contrast audit on `/perfumes`, `/films` and `/publishers` at 1440, 768 and 390px: 0 issues.
- `pnpm typecheck` clean; `pnpm lint` 0 errors; `pnpm test` and the full suite (`scripts/qa/test-local.py`) 1,760 of 1,760.

### Not changed

- Hand-built image URLs in 20 files that open PRs change (#54, #56, #58, #63, #70, #76): `src/app/page.tsx`, `src/app/authors/page.tsx`, `src/app/authors/[slug]/page.tsx`, `src/app/collections/[id]/page.tsx`, `src/app/films/[slug]/page.tsx`, `src/app/library/[slug]/page.tsx`, `src/app/places/page.tsx`, `src/app/places/[slug]/page.tsx`, `src/app/publishers/[slug]/page.tsx`, `src/app/recommenders/[id]/page.tsx`, `src/app/taxonomy/[familySlug]/[itemSlug]/page.tsx`, `src/components/books/work-carousel.tsx`, `src/components/collections/add-books-dialog.tsx`, `src/components/collections/collection-card.tsx`, `src/components/layout/command-palette.tsx`, `src/components/series/series-card.tsx`, `src/lib/actions/author-map.ts`, `src/lib/actions/author-timeline.ts`, `src/lib/actions/authors.ts`, `src/lib/publishers/books.ts`.
- Three in files that SLN-302 (task 0293) changes: `src/app/library/[slug]/edition-edit-dialog.tsx`, `src/app/provenance/order-create-dialog.tsx` and `src/app/provenance/provenance-shell.tsx` (with 0293 the last two become one poster helper in `order-model.ts`).
- Provenance's `formatDate` is not a copy: it gives a short "Oct 4", where `src/lib/utils/format.ts` gives "4 October 2026". A clearer name for it waits for 0293.

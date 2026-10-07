# Task 0370: Every image address through mediaUrl

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0294
**Blocks**: None

## Overview

SLN-514, the rest of SLN-305. Task 0294 moved 17 files to `mediaUrl(key)`
(`src/lib/s3/media-url.ts`); 27 app files still built
`/api/s3/read?key=${encodeURIComponent(key)}` by hand. This task moves them
all, so one function builds every image address.

## Implementation Details

- The 33 hand-built addresses in the 27 files named in SLN-514 call
  `mediaUrl(key)`. None of them added a version or a width, so the call takes
  only the key.
- Seven local helpers only wrapped the address (`imageUrl`, `getImageUrl`) and
  now only wrapped `mediaUrl`. They are removed, and their callers call
  `mediaUrl` directly: `collections/[id]/page.tsx`,
  `taxonomy/[familySlug]/[itemSlug]/page.tsx`, `publishers/[slug]/page.tsx`,
  `collection-card.tsx`, `collections-view.tsx`, `series-card.tsx` and
  `command-palette.tsx`. A helper that adds a rule of its own, such as
  `getPosterUrl` (`order-model.ts`) or `s3Url` with its null check
  (`publishers/books.ts`), stays.
- `mediaUrl` encodes the key through `URLSearchParams`; the old addresses used
  `encodeURIComponent`. The two differ only for a key with a space or one of
  `! ' ( ) ~`, and the image route decodes both to the same key.

## Completion Notes

- `git grep '/api/s3/read?key=' -- src ':!src/__tests__' ':!src/app/api/s3/read'`
  finds nothing.
- Production builds of main (3b751e61) and this branch on the newest backup:
  every image address on 19 pages, decoded to its key, version and width, is
  the same before and after, with the same number of addresses on each page.
  The pages: the dashboard, the collections list and a collection, a book
  page (2666: 142 addresses), the people list and two people, a recommender,
  a subject with covers, the provenance board, a publisher, the series list,
  the Reading hub, and the places and films pages the dump has. The dump has
  no film with a still, no place with a picture and no publisher with a logo,
  so those three spots are covered by the same mechanical change only.
  `page-weight.js` passes every route.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 257 files, 2,867 tests, all passed.

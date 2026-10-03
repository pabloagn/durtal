# Task 0218: Gallery layout recomputes when its images change

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-306. The stored gallery layout lists media ids per cell. `getGalleryWithLayout` recomputed it only when the number of gallery images changed. After "delete one, upload one" the layout still pointed to the removed image, so the new image stayed hidden until the user pressed Randomize.

## Implementation Details

- `src/lib/utils/collage-layout.ts`: new `layoutMatchesMedia(layout, mediaIds)`. It returns true only when the layout places exactly the current media ids, each once.
- `src/lib/actions/gallery-layouts.ts`: `getGalleryWithLayout` uses `layoutMatchesMedia` in place of the `imageCount` check. A stale layout is recomputed with its existing seed, so an unchanged gallery keeps its arrangement.
- No schema change. `image_count` stays and is still written.

## Completion Notes

- New unit test `src/__tests__/utils/collage-layout.test.ts`: same images match, a replaced image, a changed count and an empty gallery.
- `pnpm typecheck` clean. `pnpm test`: 1101 passed, 391 skipped. `python3 scripts/qa/test-local.py`: 1492 of 1492 passed.

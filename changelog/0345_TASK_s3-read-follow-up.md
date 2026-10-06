# Task 0345: The last two S3 reads go through readS3Object

**Status**: Completed
**Created**: 2026-10-06
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0342 (#119)
**Blocks**: None

## Overview

SLN-300's follow-up. Changelog 0342 (#119) gave the app one whole-file S3
read, `readS3Object`, and left two reads that sat on lines #113 rewrote. With
#113 on main, they move to it too.

## Implementation Details

- `src/lib/color/backfill.ts`: `paletteOf` reads the image with
  `readS3Object`, so the cover-colour backfill also reads a preview's S3
  folder and a file with no body fails with its key.
- `setActiveMedia` (`src/lib/actions/media.ts`): the palette of a poster made
  active is read with `readS3Object`, without its own `GetObjectCommand` and
  `Body!`.
- No `transformToByteArray` is left outside `src/lib/s3/read-object.ts` and
  the preview's folder reader.
- This branch is stacked on #119 (it merges #119's branch), because
  `readS3Object` arrives with it. Land #119 first; this PR's own change is the
  last commit.

## Completion Notes

# Task 1132: Real books' covers fit the upload check

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: 1131
**Blocks**: None

## Overview

SLN-1388. With the compiled inspector live, a real book still failed its upload: a Project Gutenberg EPUB with a cover and plates (#12341, the images-3 build) wrote its ready frame and exited 1 with "Invalid native image bytes". Its cover was the cause. Each cover reserved 32 bytes a pixel of the attempt's 128 MiB native budget, so a 1600 x 2400 cover, a common size, overran it once the first output was reserved, and an overrun fails the whole attempt. The check's fixtures had no cover larger than 300 x 450.

## Implementation Details

- `src/lib/ebooks/ingest/cover.ts`: the working surfaces reserve 16 bytes a pixel, the decoded image and its rotated or resampled copy at up to 8 bytes a pixel each (16-bit RGBA), plus the 8 MiB workspace as before. Measured in this container with sharp, upright and with EXIF orientation 6, the same pipeline peaked under 8 bytes a pixel for 8-bit JPEG and PNG up to 4096 x 4096, and at 12 for a 16-bit RGBA PNG. Covers up to about 2000 x 3000 now fit.
- `coverTooLarge` checks, before any reservation, whether the cover fits: the budget's own rule (`requireImageBudget`) applied to the retained input, the working surfaces and each width's output envelope, in either orientation, on top of what the attempt already holds. A cover with no width or height says so. A cover that does not fit is left out with "The cover is too large to make covers from (W x H)" and the book is still added without one, as a cover in an unknown codec already was. The native decoder is still never called for it.
- A cover whose decoded size differs from its header, or that has more than one page, is now a damaged cover with its reason, not a breach: only the header has been read at that point. A real breach, such as an encoded cover over its reserved envelope, still fails the attempt.
- Fixtures: `node scripts/qa/make-ebook-fixtures.mjs --covers` writes `cover-jpeg.epub` (a 1600 x 2400 JPEG cover encoded by sharp, and a PNG plate) and `cover-png.epub` (a 1600 x 2560 PNG cover). No download.
- `pnpm ebooks:check-inspector` runs both as well, requires three covers from each, and prints the cover reason when they are missing.
- Tests: `src/__tests__/ebooks/ingest/cover-budget.test.ts` prepares both fixtures with `prepareFile` in one budgeted attempt, as the check does, gets three covers and leaves it healthy; a 3000 x 4500 cover is left out with its reason. It fails on main. `upload-worker-bounds.test.ts` now expects a 16384 x 16384 cover to be left out with its reason, before the native decoder, instead of failing the attempt, and a cover whose size differs from its header to be reported as damaged.

## Completion Notes

A cover over about 2000 x 3000 is still left out (with its reason, and the book added). Decoding a JPEG at a reduced size on load could fit larger ones within the same budget; that is not done here.

The PDF path is unchanged: pdf.js's image hooks still reserve 32 bytes a pixel for images on the page it renders as the cover, inside the pinned pdf.js patch. A scanned PDF with a large first-page image may still fail its check; that is a separate change.

On the Mac, after rebuilding the inspector, `pnpm ebooks:check-inspector` should print ok with three covers for both cover fixtures.

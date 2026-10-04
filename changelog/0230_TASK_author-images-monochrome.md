# Task 0230: Every author image is monochrome

**Status**: In Progress (code complete; the re-render of existing images waits for approval)
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-422. Every image of a person must be monochrome, with no exceptions. Only portraits were: `imagePolicy()` returned the colour `BACKGROUND` policy for every background before it reached the author case, so author backgrounds (David Peace's banner, for example) were stored and served in colour, and so were author gallery images.

## Implementation Details
- `src/lib/media/policy.ts`: `imagePolicy()` works out the shape (slot, fit, sizes) per media type as before, then sets `monochrome: true` for every author image: portrait, background and gallery. The slot and sizes still follow the type, so a background stays a 2560x1440 landscape. Every other owner keeps its colours.
- New uploads and URL imports go through `ingestMedia`, which already renders a monochrome image (and keeps a colour original for re-tuning) when the policy says so. Image adjustments already lock saturation, grayscale and sepia for any media row of an author.
- `src/app/api/media/reprocess-author/route.ts`: re-tuning now refuses a row that is not a person's. Paintings also keep originals, so a painting could be turned grey through this route before.
- `src/lib/media/author-monochrome.ts` (new): scans author images and checks the files the app shows (the channels of a grey image have the same mean); re-renders a colour one in monochrome from its colour original with its tuning, keeping its crop (an image stored before it had an original first gets one: its uncropped colour file is copied); undoes that; and replaces a legacy colour portrait (`authors.photo_s3_key`, shown when an author has no poster image).
- Legacy portraits: every author with a colour `photo_s3_key` gets a monochrome copy at `gold/media/author/<id>/photo/<uuid>.webp`, and the column points at it. The colour file stays for undo. An author with no poster image also gets one made from it. Before a pre-merge review, the script only made the poster and left the column on the colour file: if that poster were removed later, `/authors` and the dashboard would fall back to the colour photo, and Harmonize would offer to reuse it as a poster as it is. Authors who already had a poster and a colour photo were not looked at.
- `scripts/authors/monochrome.ts` (new): dry run by default, with counts per image type and the list of images it would change. `--apply` needs `--backup FILE` (a pg_dump made just before), writes every change to an undo file and counts again. `--undo FILE` restores the colour files, puts each legacy portrait's colour key back (before it removes the poster image made from it) and deletes the monochrome copies.
- Tests: `src/__tests__/media/policy-presentation.test.ts` (every author image type monochrome; every other owner in colour), `src/__tests__/integration/media-ingest.test.ts` (served files are monochrome for portrait, background and gallery, the original stays in colour; re-render keeps the crop and undo restores colour; a legacy portrait becomes a poster image, its column points at a monochrome copy, and both are undone; a colour photo behind an existing poster is replaced too; a column that changed since the scan is left alone, with no file left behind; a painting cannot be re-tuned).
- Docs: `docs/02_DATA_MODEL.md` (author monochrome processing), `docs/03_DESIGN_LANGUAGE.md` (Images of people).

## Completion Notes
- `python3 scripts/qa/test-local.py media-ingest policy-presentation image-adjustments`: 56 tests pass; the full suite results are in the PR.
- Existing images are not changed yet: the script's dry run and `--apply` read and write the live database and storage, which waits for Pablo's approval. Steps once approved:
  1. `docker run --rm -e PGURL postgres:16 sh -c 'pg_dump --format=custom "$PGURL"' > ~/personal/durtal-backups/live-before-author-monochrome-<date>.dump`
  2. `pnpm exec tsx --tsconfig tsconfig.json scripts/authors/monochrome.ts --env-dir ~/personal/durtal` (dry run: counts and list)
  3. the same with `--apply --backup <the dump>`; then Settings → Data → Refresh cached data
  4. check `/authors/david-peace`; undo with `--undo author-monochrome-undo.json`

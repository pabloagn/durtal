# Task 0560: Review previews stay small at any library size

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-691. On a library of 6,000 eBooks, review decisions failed with "This
preview expired": Choose a book's Preview link, Keep as eBook, Review this
match. Every review plan freezes the whole matching catalogue (works,
editions, instances, eBooks, their files and candidates, and seven more
tables) so its write can prove nothing changed, and the preview cache held
that copy in memory for each preview. On the 6,000 eBook preview one keep
preview was 31.5 MB (`ebook_files` 19.4 MB, `ebooks` 6.5 MB, `editions`
2.2 MB, `instances` 1.7 MB, `works` 1.3 MB) against a 32 MB cache: a second
preview pushed out the first, and a library with candidates or longer file
metadata went over the limit, which is refused with the same
`preview_expired` code.

## Implementation Details

- `src/lib/ebooks/review/preview.ts`: the cache keeps a plan's row sets
  (`snapshot.rows`, and an unlink's `dependencies.rows`) as one SHA-256 per
  table and stores the plan without them. A preview is now about 4 KB.
- On confirm, `require`, `requireAccession` and `requireUnlink` read the
  current rows (`previewRowsLoader`, one repeatable-read snapshot) and put
  them back only if every table hashes the same; otherwise the confirm is
  refused as `stale_review`, "The library changed after this preview.
  Prepare a new review." The plan the writer gets is identical to the one
  previewed, and the receipt keeps the hash of the whole previewed envelope.
- The writers' transaction guards are unchanged: they still compare every
  table under lock, so a change between the reread and the write is refused
  as before.
- `service.ts`, `bulk.ts` and `unlink-service.ts` await the cache with the
  loader. Book status previews have no row sets and read nothing.

## Completion Notes

- Tests: `preview.test.ts` (two previews on 6,000 files' worth of rows both
  confirm and read the rows back; a changed or missing table refuses; an
  unlink without row sets reads nothing), and a new database suite,
  `ebook-review-scale.test.ts`, on 6,000 eBooks with about 4 KB of metadata
  per file: an earlier preview still confirms after a later one, and the
  later one is refused once the first changed the library. It fails on the
  old cache with "This preview exceeds the private cache limit."
- Measured on the 6,000 eBook preview: two cached previews are 3.9 KB each
  (31.5 MB before). Prepare takes about 7 s as before; a confirm now rereads
  the library first, about 4 s of its 8.5 s.
- Not covered: the confirm's reread and the writers' whole-table guards both
  scale with the library. Comparing hashes in SQL instead would cut both.

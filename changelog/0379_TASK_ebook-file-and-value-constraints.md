# Task 0379: Each e-book file belongs to one e-book, and the value lists are checked

**Status**: Completed
**Created**: 2026-10-07
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0348
**Blocks**: None

## Overview

SLN-518, the e-book epic's sub-issue 1b. The review of SLN-490 (#130) found two
gaps in the four e-book tables. A preferred file, a position or an annotation
could name another e-book's file, because each referenced `ebook_files(id)`
alone. And three value lists of the epic's contract had no check: the review
stored an `import_source` outside the list. The tables are empty on live until
the bulk load, so the constraints go in now, with no rows to check.

## Implementation Details

Migration `0080_ebook_constraints`, generated from the schema files with
`pnpm db:generate`, plus one statement written by hand:

- `ebook_files`: UNIQUE (`id`, `ebook_id`), `ebook_files_id_ebook_unique`.
- `ebook_positions`: the key on `file_id` alone is replaced by
  `ebook_positions_file_ebook_fk`, (`file_id`, `ebook_id`) → `ebook_files`
  (`id`, `ebook_id`), on delete cascade.
- `ebook_annotations`: the same, `ebook_annotations_file_ebook_fk`, on delete
  restrict.
- `ebooks`: `ebooks_preferred_file_ebook_fk`, (`preferred_file_id`, `id`) →
  `ebook_files` (`id`, `ebook_id`), on delete set null (`preferred_file_id`).
  Drizzle cannot declare a set-null that clears one column of a composite key,
  so this statement is custom SQL at the end of the migration, and a comment on
  `preferredFileId` in `src/lib/db/schema/ebooks.ts` names it. The schema's
  single-column key stays; both clear the same column when a file is deleted.
  The form needs PostgreSQL 15 or later; live runs 16.15 (checked read-only by
  the merging thread).
- Checks: `ebooks_import_source_check` (`folder`, `upload`),
  `ebooks_match_method_check` (null, `isbn`, `identifier`, `score`, `manual`,
  `accession`) and `ebook_files_drm_check` (null, `adobe-adept`, `kindle`,
  `readium-lcp`, `apple-fairplay`, `pdf-password`, `unknown`).
- Drizzle wrote the two new keys before the unique they reference, which
  PostgreSQL refuses; the migration puts the unique first.

`docs/02_DATA_MODEL.md` names the unique, the three keys and the three checks
in the four tables' sections, with the reason: a file belongs to exactly one
e-book, so nothing can point at another e-book's file. The epic's contract
(SLN-489, "Integrity") already says the same. No route, page or service
changes.

## Completion Notes

- `src/__tests__/integration/ebook-constraints.test.ts` (new database suite,
  `DURTAL_EBOOK_CONSTRAINTS_TEST_DATABASE_URL`, `sln518_ebook_constraints`), 3
  tests:
  - a position, an annotation and a preferred file of another e-book are each
    refused with SQLSTATE `23503` and their own key's name; the e-book's own
    file is accepted for each;
  - `import_source = 'sync'`, `match_method = 'guess'` and `drm = 'kfx'` are
    each refused with `23514` and their check's name; every listed value, and
    null for `match_method` and `drm`, is accepted;
  - deleting a file clears the preferred file and keeps the e-book, deletes
    the file's positions, and is refused while an annotation names it.
  - With the journal cut back to 0079, all 3 tests fail.
- Migration 0080 rehearsed on the newest backup
  (`live-before-0079-20261007-093544`) through `scripts/qa/preview-local.py
  --from-dump`: it applied, the database lists 80 migrations, and a read-only
  query of `pg_constraint` lists the unique, the three keys and the three
  checks as written above. The four tables hold 0 rows.
- `src/__tests__/integration/ebook-catalogue.test.ts` and
  `work-kind-migration.test.ts` pass unchanged.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 263 files, 2,956 tests, all passed.

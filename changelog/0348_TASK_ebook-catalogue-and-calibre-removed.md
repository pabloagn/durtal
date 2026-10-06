# Task 0348: SLN-490 The eBook data model, and Calibre removed from Durtal

**Status**: Completed
**Created**: 2026-10-06
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: 0343 (SLN-480, migration 0074)
**Blocks**: The other 19 sub-issues of the e-book reader epic (SLN-489)

## Overview

Sub-issue 1 of 20 of the e-book reader epic (SLN-489). Joris: "we're
DECOUPLING from Calibre ... the expectation is we DO NOT depend on Calibre
for anything in this app." It lays the e-book catalogue every later
sub-issue builds on, and it removes Calibre from Durtal: the tables, the
columns, the old reader built on them, the sync script, the settings, the
labels and the docs. Nothing is uploaded and no new reader exists yet;
sub-issue 3 builds it.

## Implementation Details

- Migration `0075_ebook_library_guards` (custom SQL, first): four guards
  stop it with a plain message when `reading_progress` or `calibre_books`
  holds a row, a copy has a `calibre_id` or `calibre_url`, or an image
  adjustment is for a cover of the old reader. Then the "Calibre" digital
  location is renamed "eBooks" in place (its id and copies stay), or an
  "eBooks" digital location is made when there is none.
- Migration `0076_ebook_catalogue` (generated, then two triggers and the
  setting): the tables `ebooks`, `ebook_files`, `ebook_positions`,
  `ebook_annotations`; `app_settings.ebook_location_id`; drops
  `calibre_books`, `reading_progress`, `instances.calibre_id` and
  `instances.calibre_url`. The trigger `ebook_book_instance_required`
  (`require_ebook_book_instance()`) refuses a copy that is not of a book
  (`23514`, `ebook_book_instance`, "An eBook can only be a copy of a
  book"). The trigger `ebook_copy_removed` sends an e-book back to
  `pending`, with its files, when its copy is deleted.
- Schema: `src/lib/db/schema/ebooks.ts`, `ebook-positions.ts`,
  `ebook-annotations.ts`; `calibre-books.ts` and `reading-progress.ts`
  deleted; the two columns leave `instances.ts`.
- Read side: `src/lib/ebooks/queries.ts` (`getEbook`, `getEbooksForWork`,
  `getWorkIdsWithEbooks` in one query per page, `getRecentlyOpened`) and
  `src/lib/ebooks/formats.ts`. The library's cover mark ("eBook
  available"), the book page's Read button and the copy row's "eBook" line
  (formats, size, Open) read the new catalogue.
- The old reader goes: `src/app/reader/`, `src/app/api/reader/[calibreId]/`,
  the epub.js components, `src/lib/calibre/`, `scripts/calibre_sync/`. The
  reader settings types and cookie validator move unchanged to
  `src/lib/reader/settings-cookie.ts`; Settings › Reader keeps working on
  the same cookie. The sidebar's Reader entry goes; `/reader` answers 404
  until sub-issue 8.
- Interchange version 2: `instances` loses the two columns. A version 1
  file still imports when they are empty on every copy
  (`src/lib/interchange/version-1.ts`) and is refused, naming the count,
  otherwise.
- The word: "eBook" for the format everywhere; Settings › Integrations has
  an "eBooks" group; the copy form loses the two Calibre inputs; the
  validations, the wizard and `POST /api/instances` stop accepting them.
- `src/__tests__/cross-layer/no-calibre.test.ts` keeps Calibre out of
  `src/`, `scripts/`, `public/`, `docs/` and the root files, with the two
  allowances of the spec (OPF names `calibre:<name>` under
  `src/lib/ebooks/ingest/` and `src/__tests__/`, and text fixtures under
  `src/__tests__/fixtures/ebooks/`).
- Dependencies removed: `epubjs` (npm) and `boto3` (Python, with
  `botocore`, `jmespath`, `s3transfer` and `urllib3` in `uv.lock`).

## Completion Notes

- Stacked on SLN-480 (#126, migration 0074, head b6670d99). After the
  rebase, `pnpm drizzle-kit generate` finds no schema change.
- Rehearsal: `scripts/qa/preview-local.py --from-dump` on
  `live-before-cover-colors-20261006-151958.dump`, every pending migration
  through 0076. Before: `calibre_books` 0 rows, `reading_progress` 0 rows,
  0 copies with a `calibre_id` or `calibre_url`, 0 image adjustments for
  old reader covers; the "Calibre" digital location
  (`c055eece-124b-4d7a-9a1a-063e8fd77d22`) held 100 of 242 copies. After:
  the same location, same id, named "eBooks", with the same 100 copies (242
  in all); `app_settings.ebook_location_id` points at it; both triggers
  exist; the four new tables are empty. The row reconciliation (118
  tables, 21,839 rows) lists only the two dropped tables, the two dropped
  copy columns and the one renamed location row.
- Tests: `ebook-catalogue.test.ts` 8 tests (guards one by one, rename,
  re-run, fresh database, triggers and checks, a removed copy, one query
  for 48 works, file order, the newest place per e-book);
  `no-calibre.test.ts`; four suites updated for the change (the reader
  route in navigation and the S key, the dropped copy columns in the
  publisher migration rehearsal, the "eBooks" location every database now
  has in the venues suite). Full suite (`scripts/qa/test-local.py`) on
  the final head: 2,527 tests in 223 files passed, none skipped.
- Page weight on the same dump, before (f8285a94, the branch's base then)
  and after: no route gained bytes; `/library` 296 → 295 KB, `/` 254 → 253 KB.
  The time budget failures come and go on both sides with the dev server
  (before: 6 routes, after: 4; none of them changed here).
- Browsers, headless Chrome, WebKit and Firefox at 1440, 768 and 390 px on
  the rehearsed dump, with one e-book linked to a copy of 2666: `/library`,
  the book page and its copy row ("eBook  EPUB, PDF · 3.4 MB  Open"), the
  edit and add copy dialogs with Digital details open, the wizard's copy
  step with Digital details, `/locations`, Settings › General, Reader and
  Integrations. No alignment deviation over 0.5 px, no overflow, no
  unnamed or nested control. Chrome alone reported 3 and 4 low-contrast
  items in the add copy step at 768 and 390 px: single 38 px letters in
  `fg-muted`, which are not dialog controls; the same dialog in edit had
  none. The rendered text and
  every `option` of each page and dialog hold no "Calibre".

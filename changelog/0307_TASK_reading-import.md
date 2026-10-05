# Task 0307: Goodreads, StoryGraph and seed import

**Status**: In Progress
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0302 (SLN-444), 0305 (SLN-448)
**Blocks**: Reading tracker steps 7 to 15 (SLN-442)

## Overview

Step 6 of 15 of the reading tracker (SLN-442, sub-issue SLN-450). Joris
brings his reading history in from a Goodreads export, a StoryGraph export,
the reading columns of his seed spreadsheet, or a Durtal reading CSV, and sees
every row and its book before anything is written. Each row is matched to a
book with a stated reason, he decides the doubtful ones, the same file never
writes twice, a book rating never changes without being shown, and a whole
import can be undone. Migration 0066 adds `reading_import_rows` and
`imports.file_name`.

## Implementation Details

- Migration `0066_reading_import.sql`: `reading_import_rows` (`import_id`
  cascade, `row_no`, `data`, `match`, `decision` with its CHECK,
  `use_file_rating`, `work_id` set null with `book_parent_required`,
  `written`; key `(import_id, row_no)`, index on `work_id`) and
  `imports.file_name`. The migration and book-isolation tests list the table;
  the migration test reconciles `file_name` on a legacy import.
- Parsing (`src/lib/reading/import/`): `csv.ts` (RFC 4180, BOM, CRLF, the
  `'` formula guard, never evaluated), `formats.ts` (`detectFormat` by header
  names, `GOODREADS_EXPORT_HEADER`), `durtal-format.ts`
  (`DURTAL_READING_COLUMNS`), `fields.ts` (trimmed and cut cells, ISBNs with
  their check digit, dates, half stars ties up, sanitized reviews: Goodreads'
  `<b>` and `<i>` kept as `<strong>` and `<em>`, plain text as paragraphs),
  and one pure mapper per format to `ImportRow` (`goodreads.ts`,
  `storygraph.ts`, `durtal.ts`), every key from `source-keys.ts`.
- Matching (`match.ts`, `match-rules.ts`), books only, one query per batch of
  1,000 rows: the Durtal work id; a reading that already has one of the row's
  keys (an earlier import of the same file, so a book chosen by hand is
  found again); the Goodreads Book Id (an edition's `goodreads_id` or a
  goodreads catalogue identifier); the id in `works.goodreads_url`; an ISBN.
  Then title and author: the file's title (series marker and subtitle
  dropped) against every title a book is known by, its own and its editions',
  with `strict_word_similarity` both ways after `search_normalize`, for the
  books whose author's surname matches. Likely: one book at 0.8 or more with
  its author, or the one with the same title among close ones; candidates from
  0.5, at most three; a book with the same title and another author is only a
  candidate. Several books for one identifier are candidates, never exact.
- Already in Durtal: each book's rows go through `duplicateVerdicts` with the
  count rule together; an open Goodreads or StoryGraph read for a book being
  read is already there; a Durtal file's open row naming another reading
  cannot be imported.
- Upload: `POST /api/reading/import` (same origin, one CSV up to 10 MB):
  parse, match, then the import and its rows in one `atomic` (500 rows per
  insert), then the raw file to `bronze/imports/<id>/<safe name>` as a best
  effort.
- Actions (`src/lib/actions/reading-import.ts`, the work in `store.ts`):
  `decideImportRow` (Import, Skip, a chosen book, the file's rating),
  `decideImportSection`, `rematchImport`, `commitReadingImport` (verdicts
  checked again, a book's rows in one `writeReadings` call, chunks of at most
  100 readings, `written` after each chunk, the Goodreads id recorded on an
  edition matched by ISBN) and `undoReadingImport` (unedited readings only,
  ratings back only while unchanged, identifiers removed). `writeReadings`
  writes an undated read the count rule called present when
  `allowPossibleDuplicate` ("Import anyway").
- Pages: `/reading/import` (upload, past imports, Undo, "Raw file not kept")
  and `/reading/import/[id]` (summary, the commit button that says what it
  writes, "What this file cannot carry", seven sections of 50 rows with "Show
  50 more", the book picker, candidates, "Add this book" and Match again on
  return, the rating line). The rows of a section render in one client list
  from small row views (`row-view.ts`), and their buttons share one utility
  class (`row-chip`), so 50 rows a section stay within the page budget. The
  Import tab is on; `/reading` with no reading offers the import; Settings,
  Data has "Import reading history"; `/library/import` points to it.
- The book picker takes a caller's `onPick`, title, first query and add link.
- Seed step: `scripts/ingest/seed_readings.py`, `--step readings --out DIR`
  (not in `--all`): reads the Books sheet as `seed_books.py` does, resolves
  books read-only, writes `readings.csv` and `priority-ratings.csv`, and stops
  on a `Read` value it cannot map.
- `scripts/qa/preview-local.py --s3-dir DIR`: the app keeps S3 objects as
  files under DIR for that run (`src/lib/s3/preview-dir.ts`).
- `scripts/qa/test-local.py` runs every `scripts/qa/test_*.py`.
- Journey: `node scripts/qa/journeys.mjs --disposable <preview> import`
  (seed `scripts/qa/reading-import-journey.sql`).
- Docs 02, 04, 05, 06 and 09.

## Completion Notes

- Tests: unit `import-parse.test.ts` (the CSV reader with quotes, doubled
  quotes, newlines in quotes, CRLF, BOM and the formula guard; `detectFormat`
  with and without Book Id; the column lists; half stars; reviews; the
  Goodreads, StoryGraph and Durtal mappers on synthetic fixtures in
  `src/__tests__/fixtures/reading-import/`: read counts and their numbering, a
  currently-reading row with a read count, DNF and on-hold shelves, quarter
  stars, date ranges in the formats exports have used, missing columns, the
  `isbn13:` and `title:` keys, mixed precisions and an inverted range, each
  Durtal key case and every refused value), `import-preview.test.ts` (title
  normalization, the likely bar, sections, default decisions, a book's
  verdicts, the preview's words, "Add this book", the row view), route
  `reading-import-route.test.ts` (another site, not a CSV, over 10 MB, an
  unknown format, the safe S3 name, S3 refusing), `preview-dir.test.ts`, and
  the database suite `reading-import.test.ts` (every exact reason, likely
  through an English edition title, possible and none, 2,000 rows in 4
  queries; month and year against a day, the undated count, Import anyway,
  open reads; decisions, bulk actions, choosing a book, Match again, a chosen
  book found again by its source; commit, re-commit and re-upload writing
  nothing, a failed second chunk finished by a second run; book ratings set,
  kept, replaced and restored only while unchanged; the Goodreads identifier
  recorded once; undo keeping an edited reading and committing again; the
  decision CHECK, cascades, a merge, a deleted book, a film refused; a
  StoryGraph file). The
  migration and book-isolation tests know the table. Python
  `test_reading_seed.py`: 10 tests.
- `pnpm typecheck` clean; `pnpm deadcode` clean; `pnpm lint` 0 errors, 81
  warnings, none in the new files; `python3 scripts/qa/test-local.py`: both
  Python test files, then 186 files, 2091 tests, 0 failed, 0 skipped.
- Matching on a preview of `live-before-0064-0065-20261005-013641.dump`
  (699 books, 505 editions with an ISBN-13, 2 with a Goodreads id), with a
  synthetic 2,000-row Goodreads file built from it (502 rows by ISBN, 187 by
  title and author, the rest invented or to read): parsed, matched and stored
  in 0.54 to 0.82 s. Thresholds 0.8 (likely) and 0.5 (candidate). Sections:
  500 exact, 188 likely, 3 to choose, 1,207 not in Durtal (the invented
  ones), 2 already in Durtal, 100 not imported. Every real title found its
  book. The first run had 11 to choose: "The Familiar, Volume 5" scored 1 and
  volumes 1 to 4 scored 0.909, so the one book with the same title among
  close ones is now likely; the 3 left are books catalogued twice (Solaris,
  Roadside Picnic, Ada or Ardor).
- Page weight on that preview, main and after: every route within budget
  except `/harmonize` in two runs while other heavy jobs ran (1,018 and 3,056
  ms; 324 ms on main). Measured again side by side on a quiet preview, six
  requests each: 145 to 268 ms on main, 159 to 239 ms with this change. Its
  scan reads no table this change adds. `/reading/import` 48 KB; `/reading/import/*` with
  the 2,000-row import as the newest: 815 KB in the first version, 360 KB and
  237 ms after the rows went to one client list with one button class
  (`row-chip`) and only what each row has.
- Browsers, Chrome, Firefox and Safari at 1440, 768 and 390 px: the import
  list, a 2,000-row preview, a committed preview with outcomes, a second
  upload with nothing to import, "Show 50 more", the book picker from a row,
  `/library/import`, Settings › Data, the reading tabs, and on a second
  preview `/reading/import` with no import and `/reading` with no reading.
  No alignment, contrast, name or overflow finding, no console error. Fixed
  on the way: the reason line kept two lines of height, "Choose a book" sat
  mid-row, Match again showed with no row left without a book, and two
  candidates with one title now show their years.
- Journeys on disposable previews: `import` with `--s3-dir` (the list shows
  the raw file kept) and without (`--no-s3`: "Raw file not kept"), and once
  more with a step that ticks "Use the file's rating" ("Book rating 3
  replaced by 4") and unticks it; `reading` still passes with the picker's
  new options.
- Safari through safaridriver: the 2,000-row file chosen in the upload's file
  input opens its preview, "Import 759 readings" writes 759 readings, and
  Undo removes them.
- The database suite also imports the StoryGraph fixture: two reads from
  their ranges, the 3.75 saved as 4 on the later one, the inverted range in
  Cannot import.

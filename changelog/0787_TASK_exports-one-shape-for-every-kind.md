# Task 0787: Every export has the same shape

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-894, from the Sixth reviewer's print and export survey (E1 to E4) and the
Third reviewer's import and export survey of 16 Oct (items 2 and 3). The
exports differed by kind: JSON for books only, no byte order mark on TSV, no
charset on the catalogue's CSV and TSV, `""` for a missing value in JSON and
Parquet, every Parquet column text, books and people in database order, an
empty Parquet file refused with a 404, files named `durtal-authors-all-…` and
`durtal-readings-…`, and messages such as "Exported 1 works as PARQUET". The
People export held only book authors (22 of 622 people) while its description
promised every person.

## Implementation Details

- `src/lib/utils/export.ts`:
  - `toTSV` writes the byte order mark, as `toCSV` does. The reading importer
    takes CSV only, so no import path changes.
  - `typedRow` and `toJSON`: the columns in order, a missing value (`""` or
    absent) as null.
  - `toParquet(rows, headers?)` types each column from its values: whole
    numbers INT64, other numbers DOUBLE (and rating, percent and centimetre
    columns always), booleans BOOLEAN, `YYYY-MM-DD` DATE, ISO instants
    TIMESTAMP_MILLIS, nested data JSON, anything else or mixed TEXT (UTF8).
    With headers and no rows it writes a file with its schema.
  - A spreadsheet cell reads as before: a boolean is yes or no, nested data
    JSON text, null nothing. So the CSV and TSV texts do not change.
- `src/lib/export/formats.ts`: CSV, TSV, Parquet and JSON for every kind; the
  commonplace book also Markdown; the Goodreads file CSV only. CSV and TSV are
  sent with `charset=utf-8`.
- `src/app/api/export/route.ts`:
  - One `exportFile` writes every format for the catalogue and the reading
    exports. An empty reading export is a file in every format.
  - Books: sorted by title (`compareWorks`, accents and case aside), rating a
    number, `is_anthology` a boolean, acquisition targets and edition
    publishers kept as nested data, null for a missing value.
  - People: every person, not only book authors, by sort name (else name),
    with a `roles` column: their credit labels across the collections, books
    first and Author first ("Co-author; Director").
  - File names: `durtal-<kind>[-all]-<date>`, `books` and `people` for the
    kinds, `-all` when the file holds every record. One record's file is
    still named after it; a name that slugs to nothing (Cyrillic) falls back
    to `durtal-book-<id prefix>-<date>`.
- `src/lib/export/collections.ts`, `src/lib/export/reading.ts`: favourite and
  `page_roman` are booleans.
- `export-menu.tsx`: one noun table (book and books, person and people, …),
  plural by count with thousands grouped, and the menu's own format name:
  "Exported 1 book as CSV", "Exported 1,200 books as Parquet". The `noun`
  props are gone.
- Settings > Data: "Download Goodreads file" keeps its capital; the success
  message names the format; People's description says roles.

## Completion Notes

- Unit: `utils/export.test.ts` (BOM, typed rows, CSV unchanged, Parquet types
  read back, empty schema, mixed column, formats, charset, messages) and
  `export/book-json-route.test.ts` (typed book JSON, JSON for every kind but
  Goodreads, title order, the Cyrillic file name, selection names, charset).
- Database: `write-routes.test.ts` (People: everyone, sort-name order, roles,
  the file name), `reading-export.test.ts` (empty Parquet and JSON, typed
  JSON and Parquet for readings, sessions and notes, CSV still yes or no),
  and the film and perfume export tests for the boolean favourite.
- No migration and no new packages.

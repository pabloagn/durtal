# Task 0315: Reading tracker 14/15, export and API stats (SLN-458)

**Status**: Completed
**Created**: 2026-10-06
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0307 (SLN-450), 0310 (SLN-453), 0312 (SLN-455), 0313 (SLN-456), 0314 (SLN-457); SLN-480 (#126)
**Blocks**: 0316 (SLN-459)

## Overview

Joris's reading data is never locked in. He exports every reading, session,
quote and note in the formats Durtal already offers, takes his history to
Goodreads or StoryGraph with one Goodreads-compatible file, keeps his
commonplace book as Markdown, and imports a Durtal export back with nothing
duplicated. `GET /api/stats` and the TUI's dashboard know about reading.

## Implementation Details

- **Safer CSV for every export** (`src/lib/utils/export.ts`): a text cell
  that begins with `=`, `+`, `-`, `@`, a tab or a carriage return gets a
  leading `'`; numbers are never changed; the reading importer's parser
  strips the `'` again. A value with a carriage return is quoted. CSV starts
  with a UTF-8 byte order mark. `toCSV` and `toTSV` take an optional header
  list and then write the header even with no rows. `md` is a new format.
- **Rows** (`src/lib/export/reading.ts`): `readingExportRows` (exactly
  `DURTAL_READING_COLUMNS`, then `edition_title`, `edition_language`,
  `translators`, `copy_location`, `session_count`, `minutes_read`,
  `pages_read`; `source_key` is the stored key, else `durtal:<id>`),
  `sessionExportRows` (no running timer), `noteExportRows` (with #126's
  `end_page`, `page_roman` and `edition_label`) and `commonplaceNotes`, and
  `loadGoodreadsBooks`. Numbers are `float8`; pages come only from
  `countedPagesSql`, summed per reading or session, then rounded.
- **The Goodreads file** (`src/lib/export/goodreads.ts`, pure): one row per
  book with a reading or in Up Next, in `GOODREADS_EXPORT_HEADER`. Shelves
  follow `readingStateSql` (`currently-reading`, plus `paused` in
  Bookshelves; `read`; `did-not-finish`; `to-read` for an unread book in Up
  Next). My Rating rounds a half star up and is 0 for a book never finished
  nor abandoned; Date Read only at day precision; Book Id from the latest
  reading's edition, any edition, a `goodreads` identifier, then the book's
  link.
- **The commonplace book** (`src/lib/export/commonplace.ts`, pure): one
  heading per book with its author, passages in page order cited as the
  pages cite them (`noteWhereText`), thoughts under them, favourites marked.
- **Route** (`POST /api/export`): the entities `readings`,
  `reading-sessions`, `reading-notes` and `goodreads`; `filters` (the
  journal's or the commonplace book's URL query, parsed by
  `parseJournalQuery` and `parseNotesQuery`, not cut at 500); Markdown for
  notes only, CSV only for Goodreads; a header-only file instead of "No
  records found" (Parquet with no rows keeps 404). The notes filter is now
  one module, `notesCondition` (`src/lib/reading/notes-conditions.ts`),
  shared with `searchNotes`; the journal gains `journalReadingIds`.
- **Pages**: Settings, Data has Readings, Reading sessions, Quotes and
  notes and Goodreads file rows; the Goodreads row first says "12 half-star
  ratings will be rounded up" when the file carries any
  (`getGoodreadsExportNotice`, `src/lib/actions/reading-export.ts`). The
  journal and the commonplace book have an Export menu on their summary
  line that exports what their filters show (`exportFilters`).
- **`GET /api/stats`** keeps its shape and gains `reading`: `year`, `open`,
  `finishedThisYear`, `pagesThisYear`, `hoursThisYear` and `goals`
  (`src/lib/reading/api-stats.ts`).
- **TUI**: a Reading panel on the dashboard; its text is
  `reading_panel_lines(stats)` (`scripts/tui/reading_panel.py`, pure), with
  "Reading needs a newer Durtal server" for an older server.
- Docs 04, 05 and 06.

## Completion Notes

- Built on #126 (SLN-480): its branch is merged into this one, so the notes
  export carries `end_page`, `page_roman` and `edition_label`, and the
  commonplace book cites "pp. 212–213 · Gallimard, 1928 · ch. 7".
- Tests: `src/__tests__/utils/export.test.ts` (headers for empty files, the
  formula guard on every kind of cell, carriage returns, the BOM, read back
  by the importer's parser), `src/__tests__/export/goodreads.test.ts`
  (shelves, half stars, My Rating 0 without a finished or abandoned read, day
  dates only, re-read counts, Up Next, did-not-finish, paused, the Book Id
  order), `src/__tests__/export/commonplace.test.ts`, the database suite
  `reading-export.test.ts` (the Durtal round trip and the Goodreads round
  trip both write no reading, history, queue or note; an empty export is a
  Durtal file with 0 rows; pages and sessions' pages match countedPagesSql,
  a going-back session counts 0, the running timer is left out; numbers are
  numbers; the formula guard in every export and the works export; the
  journal's and the commonplace book's filters; `/api/stats` with and without
  readings and a goal), and `scripts/qa/test_tui_reading.py`.
- `python3 scripts/qa/test-local.py`: 228 files, 2,563 tests; the Python tests
  pass.
- Browsers, on a seeded preview (the reading journey's books, a half-star
  read, a quote, an abandoned and an open reading): in headless Chrome,
  WebKit and Firefox, Settings, Data shows the four rows, the Goodreads row
  says "1 half-star rating will be rounded up" before it downloads, the
  journal filtered to finished exports its reading, and the commonplace book
  filtered to quotes exports Markdown; the files keep their accents and start
  with the byte order mark (Chrome and WebKit read the downloaded bytes;
  Firefox the same request's text).
- `alignment-audit.js` and `design-audit.js` on `/reading/journal`, the
  journal filtered, `/reading/notes` and `/settings/data` at 1440, 768 and
  390: no finding. `phone-audit.mjs`: no sideways scroll at 320 to 390.
  `interaction-audit.mjs --disposable`: no failure on the three routes.
- Page weight on the same seeded preview, main then this branch: `/reading/journal`
  66,494 → 67,845 bytes, `/reading/notes` 56,535 → 58,162 (with #126),
  `/settings/data` 84,674 → 94,665 (four rows and the Goodreads dialog). Every
  route is within its size budget; server times went over on main too on a
  loaded Mac. `pnpm deadcode`: clean.

### Review fixes (PR #129)

- The Markdown commonplace book escapes every mark Markdown would read:
  backslash, star, underscore, backtick, brackets, `<`, `>`, `&`, `~` and
  `|`, and the first mark of a line that would start a heading, a rule, a
  list or a quote ("1) first" and "2026. A year" keep their numbers, with the
  backslash before the punctuation only). A line's leading spaces become
  no-break spaces, so a poem's indented verse stays indented text and never
  turns into a code block. Tests in `commonplace.test.ts`.
- The Goodreads file goes out as stored: no formula guard and no byte order
  mark (`toCSV(..., { forImport: true })`), since Goodreads and StoryGraph
  import it; a title that starts with `-` or `=` arrives unchanged. The
  spreadsheet exports keep both.
- The export menu says "Exporting…" with one ellipsis character.
- A line of only spaces between two stanzas stays blank, so it still parts
  them; only the spaces before a line's text become no-break spaces. The
  database test expects the escaped leading `=` (`## \\=Equals`).


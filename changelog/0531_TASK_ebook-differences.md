# Task 0531: E-book differences and tags

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0481 (Import existing), 0482 (ratings and reads)
**Blocks**: SLN-498 (the load)

## Overview

SLN-658, parts 1 and 3. Where a linked e-book from the e-book library and its
Durtal book disagree, the Differences section of `/ebooks/review` shows both
values, and Joris keeps Durtal's or uses the file's, row by row or for every
row shown. Nothing applies by itself and every choice can be undone. The
library's tags are counted in the Import existing report.

## Implementation Details

- `src/lib/ebooks/differences/compare.ts` (pure): `differencesOf` compares
  the e-book's fields with the edition's (title, subtitle, language, year,
  publisher, ISBN) and the work's (authors, series, number in series), after
  normalisation (case, accents, punctuation, author name forms), and only for
  a value the file has. A cover differs when the edition has none and the
  e-book has one. A wanted or on-order book is a Status row.
- `src/lib/ebooks/differences/store.ts`:
  - No table: the differences are computed from the two stored sides, for
    the linked e-books whose files carry the library's lineage.
  - Keep Durtal's sets the e-book's field to the book's value, compared and
    set in one statement with its history event.
  - Use the file's writes through `updateEdition` and `updateWork`; a cover
    goes through the matching's cover stage and lands only on an edition that
    still has none.
  - Each choice is a work history event holding both values. Undo reads it,
    puts the value back only while the written one is still there, and claims
    one undo event per choice.
  - Authors are changed on the book's page, so their rows offer Keep only, as
    do rows whose edition is locked and files with several ISBNs.
- `src/lib/actions/ebook-differences.ts`: `decideEbookDifferences` and
  `undoEbookDifferences`, at most 500 rows a call.
- `src/components/ebooks/differences-section.tsx`: links per field with
  counts, rows with the e-book's cover and both values, the two choices per
  row and for the rows shown after a confirmation, the Status row's "Mark
  accessioned…" (the existing work status dialog), and Recent choices with
  Undo and "Undo all N".
- History: `work.ebook_difference_kept`, `_used` and `_undone`.
- Tags: the Import existing report and CSV count the selected books with
  tags, their tags and the different ones. They stay in the file metadata for
  the enrichment epic; none is written to the taxonomy.
- The store finds the library's e-books by the lineage key the ingest stores,
  so `no-calibre.test.ts` allows that one file and its database suite. The
  screen never names the library's tool.
- Docs: `04_ROUTES_AND_VIEWS.md`, `06_SERVER_ACTIONS.md`,
  `09_INGESTION_PIPELINE.md`.

## Completion Notes

- The database suite `ebook-differences.test.ts`:
  - every field and the status, for the library's e-books only, with nothing
    written by reading them;
  - Keep Durtal's and its undo, once, refused after a later change and
    possible again once the value is back;
  - Use the file's per row and in bulk (years, an ISBN, a cover, a series and
    then its number), and Undo all;
  - refusals for what is not offered and for values no longer shown, with
    nothing written.
- Unit tests: `ebooks/differences.test.ts` (normalisation, what the file
  has, series numbers, notes and refusals).
- No migration and no new package.

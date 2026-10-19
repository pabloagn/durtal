# Task 0931: Reading import checks and polish

**Status**: Completed
**Created**: 2026-10-18
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-955 and SLN-956, items 4 to 6 of `findings/import-export-survey-2026-10-16.md`.

- A date the import could not read passed silently: a Goodreads row dated `2022/13/45` showed "Finished, date unknown" and nothing more.
- An empty file was "not a Goodreads, StoryGraph or Durtal export. Its columns: none", and a file with only its header left an empty import in Past imports.
- A StoryGraph rating of 9 read "9 stars" in the row's summary, beside "9, saved as 5".
- Focus fell to the page after an upload error, Accept all likely matches, choosing a candidate, the commit and Undo.
- "1 rows changed"; a to-read book already in Up next read "Already in Up next, at 1" and "Goes to the bottom of Up next"; Undo always named "the Goodreads ids it recorded", which most imports never record.

## Implementation Details

- `lib/reading/import/fields.ts`: `dayOrWarn` reads a date as `day` does, and names a cell it cannot read on the row: "Date Read 2022/13/45 is not a date; the read will have no date". Goodreads uses it for Date Read and Date Started, StoryGraph for Last Date Read when Dates Read has no range (StoryGraph's Dates Read already named an unreadable piece).
- `lib/reading/import/parse.ts`: an empty file (nothing but a byte order mark or white space) is refused with "This file is empty", and an uploaded file with no data rows with "This file has no rows", after its format is known. That refusal is in `parseUploadedFile`, which `createReadingImport` (`store.ts`) calls; `parseImportFile` itself still reads a header-only file as no rows, so Durtal's own export of no readings still reads back as a Durtal file (the reading-export suite checks this). Both are an `ImportFileError` (`formats.ts`), the class the unknown-format refusal now extends, so the upload route answers 400 and keeps nothing. The upload page also refuses a 0-byte file before sending it.
- `lib/reading/import/preview-text.ts`: the summary line shows a rating past five stars as it will be saved; a quarter star still shows as the file has it.
- `components/reading/import/import-client.tsx`:
  - An upload refusal moves focus to its message, the same refusal twice too.
  - The row chips, the note chips and the rating checkbox are `aria-disabled` while saving, not disabled, so they keep focus; the bulk buttons, Match again and Undo use `busy`.
  - `keepFocus`: when the control that ran an action goes or turns off as the page refreshes and focus falls to the body, focus moves on: a chosen candidate's row to its next control, the commit, the bulk buttons and Undo to the import's status line (`data-import-summary`, now `tabIndex=-1`), Undo on Past imports to the import's link.
  - Words from `lib/reading/import/action-words.ts`: "1 row changed", and Undo names the Goodreads ids only when there are some, with their count.
- `lib/reading/import/page-data.ts`: the imports and the preview count the Goodreads ids each import recorded (`identifiers`).
- `lib/reading/import/row-view.ts`: a to-read book already in Up next, or being read, no longer says "Goes to the bottom of Up next"; its note says where it is, and the commit leaves it there.
- `globals.css`: `row-chip` dims when `aria-disabled`, as when disabled.
- SLN-956 item 5 (Goodreads "Author l-f") moved to SLN-1082. Item 6 (the interchange version message) was already on main: "This file is interchange version 4; this Durtal reads versions 1 to 3".

## Completion Notes

- Tests: `reading/import-file-checks.test.ts` (the four SLN-955 inputs), `reading/import-action-words.test.ts` (the plural and the Undo prompt), and a to-read row case in `reading/import-preview.test.ts`.
- Browser, on a seeded preview, in Chromium, Firefox and WebKit at 1440 and 390:
  - An empty file, a header-only file, an unknown file and a TSV are each refused with their message, and focus is on the message. Past imports gains no row.
  - A row dated `2022/13/45` shows its warning, and a StoryGraph 9 shows "5 stars".
  - After Accept all likely matches and after choosing a candidate (by keyboard), focus stays on the control. After the commit and after Undo, focus is on the status line. After Undo on Past imports, it is on the import's link.
- Alignment and design audits are clean on /reading/import and a preview, in three engines at 1440 and 390. Page weight passes on every route.

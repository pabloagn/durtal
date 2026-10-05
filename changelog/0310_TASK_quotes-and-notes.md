# Task 0310: Quotes and notes

**Status**: Completed
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0304 (SLN-447), 0305 (SLN-448), 0307 (SLN-450), 0308 (SLN-451), 0309 (SLN-452)
**Blocks**: Reading tracker steps 10 to 15 (SLN-442)

## Overview

Step 9 of 15 of the reading tracker (SLN-442, sub-issue SLN-453). A
commonplace book: Joris keeps the passages he loves and his own notes against
the page, chapter and reading they belong to, copies a printed page from his
iPhone with Live Text, finds any passage again by a few remembered words
(accents and typos forgiven), and meets one of his quotes on the hub each day.
Goodreads private notes import as notes. Migration 0069 adds `reading_notes`
and `reading_import_rows.note_decision`.

## Implementation Details

- Migration `0069_reading_notes.sql`: `reading_notes` (book, reading and
  edition set null, kind, body of 1 to 10,000 characters, the thought as
  sanitized HTML and Tiptap JSON, page, chapter, percent, star, source,
  import, `source_key`, and `search_text` generated with `search_normalize`
  and a GIN trigram index), `reading_note_comment_check` (only a quote has a
  thought), `book_parent_required`, and `guard_reading_note`: the audited
  book merge passes (it moves notes before readings), then the edition and
  the reading must be on the note's book (`reading_note_edition_work`,
  `reading_note_reading_work`); null-only updates never raise. Plus
  `reading_import_rows.note_decision`. The migration and book-isolation
  tests list the table.
- Consistency: `updateEdition` clears a moved edition from the old book's
  notes, `moveToExistingEdition` carries a placeholder's, neither touching
  `updated_at`. `deleteReading`'s snapshot keeps the ids of its notes, which
  stay on the book; `restoreReading` links them back. `getReadingCounts` and
  each reading row count quotes and notes: the book delete says "This will
  also delete 1 edition, 1 instance, 2 quotes and 1 note.", the reading delete
  "Its 2 quotes and 1 note stay with the book", the bulk delete names
  "reading history, quotes and notes".
- Actions (`src/lib/actions/reading-notes.ts`): create, update, star, delete
  and restore with the same id, `getNotesForWork`, `searchNotes` and
  `getNotesFacets`, `getPassageOfTheDay`. Pages write `source: "manual"`
  only. One `work.notes_added` per book per reading day ("Added 3 quotes and
  1 note"), its counts growing with the day's notes. Pure rules:
  `notes-text.ts` (`joinHyphenatedLines`, `formatNoteForCopy`),
  `notes-params.ts` (`parseNotesQuery`), `passage.ts` (`choosePassage`).
- The note dialog (`dialogs/note-dialog.tsx`, loaded when opened): Quote or
  Note, the passage (a pasted word broken over two lines joins up), page or
  percent, chapter, the reading, a Favourite switch, and for a quote "Your
  thought" in `TiptapEditor`. Cmd+Enter saves. On touch: the Scan Text hint,
  16px fields (iOS Safari zooms into smaller ones), the number pad, 44px
  controls. Entry points: the book page section, R Q, Log progress ("Add a
  quote" at the typed page; closing comes back to the log), the hub's cards,
  the palette, and the book picker ("Add a quote", `?then=quote`).
- The book page's "Quotes and notes", `/reading/notes` (the Notes tab:
  search, kind, favourites, book, author, year added, Newest or Book and
  page, 48 a page or the saved size), and the hub's passage of the day with
  Another. A passage over 600 characters opens at 8 lines with Show all.
  `/reading/notes` draws its list in the browser from slim rows: drawn on the
  server it sent each note twice, as markup and as its controls' data (278 KB
  with 48 notes; now 188 KB).
- Import: a "Private notes" section on the preview (the first three lines,
  the book, Import and Skip, "Import all private notes", 50 at a time), the
  commit button naming them ("Import 6 readings and 1 note, and add 1 book to
  Up Next"), the commit writing each as a note on the row's latest read with
  `goodreads-note:` keys and `written.noteIds`, and undo removing the
  unedited ones. The readings' rules read only the reading outcomes in
  `written` (`readingsCommitted`), so a row whose note is in can still be
  decided and committed for its readings. The "cannot carry" box no longer
  lists private notes.
- Fixed on the way: the shared dialog header's Expand and Close and the
  segmented control are 44 px on touch (they were 28 and 32 px).
- Docs 02 (the table, its guard and null rules, `note_decision`, `written`),
  03 (the note item, the passage, the dialog), 04 (`/reading/notes`, the
  Notes tab, R Q, the passage, the import's section) and 06 (every action,
  `decideImportNote`, the commit and undo).

## Completion Notes

- Tests: `scripts/qa/test-local.py` (every suite, a disposable PostgreSQL 16):
  201 files and 2,266 tests, none skipped. New: the database suite
  `reading-notes` (11: books only, the guards, the audited merge and a
  refused direct move, edition moves, placeholders and deletes, a reading's
  delete and restore, counts, writes with the percent, the day's event,
  search with accents, typos, filters, sorts and pages, the passage, and
  Goodreads private notes through decide, commit, re-commit, re-upload, undo
  and an import from before this step), the unit suite `notes` (19) and the
  component suite `note-dialog` (7). Three older expectations now include the
  note counts. `pnpm typecheck`, `pnpm lint` (no error, no warning in a
  changed line) and `pnpm deadcode` are clean.
- Migration rehearsal: the preview from the backup applies 0065 to 0069; every
  existing import row gets `note_decision` pending. I apply 0069 after the
  merge.
- Page weight on a production-build preview with 65 notes: every route within
  budget; `/reading/notes` 188 KB in 17 ms with 48 on the page (new budget row
  300 KB); `/` 256 KB, `/library` 299 KB, `/reading` 122 KB with the passage
  (SLN-452's preview: 256, 299, 122), `/reading/journal` 196 KB, the import
  preview 71 KB; book pages with notes 312 and 355 KB (budget 400).
- Browsers, all headless, never a window: Chrome, Firefox and WebKit (Safari's
  engine, through playwright-core) at 1440, 768 and 390 px, 12 checks each:
  the book page section with a long and a short passage and Show all (256 px
  clamped, 832 px open at 1440), its menu, the note dialog with the editor's
  toolbar, the book delete confirmation, `/reading/notes` with search,
  filters and the book grouping, the hub's passage and Another, and the
  import's private notes. 1,625 to 1,641 elements measured per browser: no
  alignment deviation over 0.5 px, no overflow, no unnamed control, no
  console error in Chrome and Firefox; WebKit's are the covers the preview has
  no S3 image for. The one contrast flag is a coverless book card's initial in
  the series carousel (decorative, not this change).
- Touch: WebKit and Chromium at 390 px with a touch screen and coarse pointer:
  the Scan Text hint shows and names the text area, the fields are 16 px, the
  page opens the number pad, every control is 44 px or more (the Favourite
  switch through its label row), nothing overflows, and typing hides the
  hint. Live Text itself was not tried: no iOS Simulator run, and Safari was
  not driven (safaridriver opens windows on Joris's screen).
- Journeys on a production-build preview: `reading` passes with its new steps
  (a quote from Log progress with a bold thought, found on `/reading/notes` by
  "convulsivo", starred, then the passage of the day) and `import` passes (a
  private note imported with its row, on its book page, gone after Undo, back
  after the second commit, and "Already in Durtal (Same source)" on a second
  upload).

# Task 0343: SLN-480 Quotes tied to editions, with page numbers

**Status**: Completed
**Created**: 2026-10-06
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0310 (SLN-453), 0314 (SLN-457)
**Blocks**: None

## Overview

A reading tracker follow-up (SLN-442, sub-issue SLN-480). Joris, 5 Oct
2026: quotes "associated with a given edition directly", with an optional
page, and the book inheriting them. Every new quote is filed under an
edition: the printing in his hands, whose page numbers it uses. It shows on
that edition and on the book, and the page is optional. Better than
Goodreads: pages with ranges and front matter, the edition and translator
named everywhere, citations, filters by edition and translator, and quotes
from the phone by ISBN. Migration `0074_quote_editions` adds two
`reading_notes` columns, a CHECK and a backfill.

## Implementation Details

- Migration `0074_quote_editions`: `reading_notes.end_page` (a passage over
  a page turn) and `page_roman` (front matter, stored as numbers), the CHECK
  `reading_note_page_range_check`, and a backfill of imported notes from
  their reading's edition that leaves `updated_at` alone. `edition_id`
  stays nullable with `on delete set null`; the guard and the indexes are
  unchanged.
- Pure rules: `src/lib/reading/notes-text.ts` (`parsePageInput`,
  `formatPageInput`, `pageText`, `noteWhereText(note, edition?)`,
  `noteCitation`, `formatNoteForCopy(note, book, edition?)`, `noteGroups`,
  `keptNotesText`), `src/lib/reading/edition-label.ts` (`editionShortLabel`,
  `editionLabels`, `noteEditionsOf`, `labelEditionOf`) and
  `src/lib/reading/note-defaults.ts` (the dialog's edition and mode).
- Actions (`src/lib/actions/reading-notes.ts`): the page rules and "Send a
  page or a percent, not both"; the percent worked out at save against the
  note's own edition, again only when the page, edition or reading changes;
  `getNotesForWork` in each edition group's order; `searchNotes` with
  `editionId` (`none` included) and `translatorId`, the "Book and page"
  sort by edition group, and `noteEditions`; `getNotesFacets(workId?)`;
  `getPassageOfTheDay` with its edition; `getReadingNote`;
  `getPersonNoteCounts`. `updateReading` takes `moveNotes`;
  `getReadingsForWork` counts each reading's notes on its own edition. The
  Goodreads import sets the edition. `workDetailWith` breaks edition ties by
  id.
- Pages: the note dialog's Edition field (no "none" on an add, "Not
  recorded" on an edit), its defaults and the text page field with its
  hints; Log progress passes the session's edition and page or percent; the
  book page's groups by edition; the edition card's Quotes row
  (`edition-quotes.tsx`) and its delete's warning; Edit reading's refile
  checkbox; `/reading/notes`'s Edition and Translator filters and the
  edition in every meta line; the passage of the day; the people page's
  Quotes and From translations; every edition picker labelled with the
  translator.
- API: `GET`, `POST /api/readings/notes` and `GET`, `PATCH`, `DELETE
  /api/readings/notes/[id]`, with the token; `editionByIsbn` shared with
  `POST /api/readings`; `spokenError` answers the notes' refusals with 400
  and 404.
- Docs 02, 04, 05 (the routes and a Shortcut recipe) and 06.

## Completion Notes

RESULTS

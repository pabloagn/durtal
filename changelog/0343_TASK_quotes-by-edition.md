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

- Migration: `0074_quote_editions`, generated with `pnpm db:generate` on
  SLN-457's `0073_reading_suggestions` (its snapshot chains to 0073); the
  CHECK comes from the schema and the backfill is custom SQL after a
  statement breakpoint. Every preview rehearsed it on the 5 Oct backup
  (`--from-dump`). There the backfill updates 0 rows: the backup predates
  `reading_notes`. Live is expected to be 0 too, as no Goodreads import with
  notes has run there; the merging thread records the live count when it
  runs the migration.
- Tests: `scripts/qa/test-local.py` (every suite, a disposable PostgreSQL
  16): 221 files and 2,519 tests, none skipped. New: the database suite `quote-editions` (15: a note
  inherits its reading's edition and keeps one sent with no reading; the
  worked example, 40.00 then 30.00, and the percent worked out again on a
  page, edition or reading change but not on a page-count edit; a
  percent-only note keeps its percent; the page rules by the action and by
  the CHECK; Undo keeps the range and roman pages; a deleted or moved
  edition, a replaced placeholder; Edit reading's refile with and without
  `moveNotes`, from no edition, never a note naming another edition, with
  `updated_at` unchanged; the import and the backfill; a book merge;
  `searchNotes`' edition, no-edition and translator filters, the "Book and
  page" sort by edition group, numbers as numbers, the facets and the
  person counts; the routes' 401, 503, 201 by edition, ISBN-13, ISBN-10 and
  book, 400, 404, PATCH, DELETE and `edition=none`), the unit tests in
  `notes.test.ts` (the page parser and its formats, roman numerals, labels
  and their tie-breaks, citations, the edition in meta lines, groups, the
  dialog's defaults) and the dialog tests (each step of the edition order,
  no "none" on an add, "Not recorded" on an edit, the edition following a
  change of Reading, the filled-in page clearing, Percent for a Log progress
  request, ranges and roman pages sent, Log progress passing the session's
  edition and page or percent). `pnpm typecheck` and `pnpm deadcode` are
  clean; `pnpm lint` has 81 warnings, as on main.
- The first full run found one fault, fixed here: a PATCH that removed a
  note's reading also dropped its edition, as the old fallback took the
  edition from the reading. A note now takes the new reading's edition only
  when that reading has one, and keeps its own otherwise.
- Page weight on a production-build preview, the same seed before (SLN-457)
  and after (a book with three editions, one with no year, two translators,
  an open reading and 200 quotes and notes): `/` 260 KB both, `/library`
  299 KB both, `/reading` 119 KB both, `/reading/notes` 195 then 203 KB,
  "Book and page" 187 then 198 KB, the translator's page 53 then 54 KB. The
  200-note book page is 849 KB before and 872 KB after: over the 400 KB
  budget of `/library/*` already before this issue, from the markup each
  note draws (SLN-453); this issue adds 23 KB, the edition, range and roman
  fields of each note, the group headings and the Quotes rows. Each edition
  is sent once (`noteEditions`), not once per note. Every route
  `page-weight.js` measures is within budget.
- Browsers, all headless, never a window: Chrome, Firefox and WebKit at
  1440, 768 and 390 px, 15 steps: the book page with four groups (three
  editions, the languages named, no edition last) and with one group (the
  description names it), the edition cards' Quotes rows and their links,
  "Add a quote" from a card (the edition filed, "Of 1056 pages", then "This
  edition has 1056 pages" at 2000, xiv-xvi accepted, a text keyboard), Log
  progress with another edition (that edition and the page typed), Edit
  reading's refile checkbox, the edition delete's warning, `/reading/notes`
  newest, by book and page, the Edition filter and no edition recorded, the
  passage of the day, a translator's and an author's page, and the Start
  reading picker. No alignment deviation over 0.5 px, no unnamed control, no
  overflow; the only contrast flags are the decorative initials on cards
  with no cover. `scripts/qa/phone-audit.mjs` finds no page that scrolls
  sideways. `scripts/qa/interaction-audit.mjs --disposable` finds no failure
  on a book page, `/reading/notes` and a translator's page; on the 200-note
  book page it opens every note's menu and did not finish in 30 minutes, so
  it ran on a book with two quotes. Its report was lost once to a race in
  its own clean-up (Chrome still writing its profile): it now retries the
  removal.
- The notes routes, with a preview-only token (left out here): no token
  401; POST by ISBN-13 at p. 212, 201 "Saved a quote from Don Quixote,
  p. 212", citation "Miguel de Cervantes, Don Quixote, tr. Edith Grossman
  (HarperCollins Publishers, 2003), p. 212"; a page with a percent 400 "Send
  a page or a percent, not both"; by ISBN-10 at pp. xiv–xvi, 201; an unknown
  ISBN 404 "Not in Durtal yet" with `addUrl`; two books 400 "Send one of
  editionId, isbn or workId"; PATCH pp. 212–213, 200; PATCH `workId`, 400;
  `edition=none`, 200 with 20; DELETE 200; the deleted note 404 "This note
  no longer exists".
- Journeys: `perfumes`, `films`, `paintings`, `reading` and `import` pass.
  The reading journey picks editions by their new
  labels ("English · Journey Reading, pocket, 2010 · 480 p.").
- Seen on the way, for later: the book page of a book with many quotes is
  over its page budget before this issue (849 KB with 200); a long group
  could open clamped with "Show all".

## Review fixes

- `POST /api/readings/notes` with `workId` and a `readingId` files the note
  under that reading's edition, as the note actions do; it took the open
  reading's edition before (a quote on the finished Penguin read went under
  the open Ecco one, with Ecco's citation and percent).
- `endPage` or `pageRoman` with no page answers 400 ("Send the first page
  with the last", "A roman page starts at i") on create and on edit; it was
  dropped with a 201. A backwards range says "The second page comes before
  the first".
- `editionByIsbn` leaves out the ISBN-10 comparison for a 979 ISBN, so an
  edition with an empty `isbn_10` is no match.
- `next-env.d.ts` was not changed by this branch: it is the same as main's.

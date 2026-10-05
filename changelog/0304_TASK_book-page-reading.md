# Task 0304: Book page reading section, start, log, finish and past reads

**Status**: Completed
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0302 (SLN-444), 0303 (SLN-446)
**Blocks**: Reading tracker steps 4 to 15 (SLN-442)

## Overview

Step 3 of 15 of the reading tracker (SLN-442, sub-issue SLN-447). On a book
page Joris can start a book (mid-book too), log progress, fix a mistyped log,
pause, resume, finish with a half-star rating and a review, abandon with a
reason, undo each of these, start a re-read, log a read from years ago with an
imprecise date, switch edition mid-read, log one sitting in another edition or
format, and see the book's whole reading history. No migration.

## Implementation Details

- Header control (`src/components/reading/reading-control.tsx`): one button
  under the title whose label is the book's state ("Start reading", "Reading ·
  p. 212 of 480 · 44%", "Paused at 44%", "Read · 14 Apr 2024", "Read 3 times ·
  2024", "Abandoned at p. 120") and a menu of the actions that make sense, each
  with its R key. The Read button follows it, both 32px (44px on touch).
- Reading section (`reading-section.tsx`): the current reading (cover, edition
  and translator, the copy and where it is, a progress bar, the start and the
  last read, the chapter, Log progress, Pause or Resume, Finish, and Abandon,
  Edit and Delete), earlier reads newest first (number, dates, outcome,
  format, edition when it changed, rating, review), and the ratings line. The
  record column has a Reading group.
- `ReadingProvider` (`reading-provider.tsx`) gives the control, the section,
  the R menu, the palette and the actions menu one set of dialogs, each loaded
  only when opened (`next/dynamic`): Start reading, Log progress, Finish,
  Abandon, Log a past read, Edit reading, Delete.
- Shared pieces: `ProgressBar`, `TiptapEditor` (`CommentEditor` now runs on
  it), `src/lib/reading/at-hand.ts` (`isAtHand`, `atHandCopySql`,
  `copyWhereabouts`, `homeOptions`), `series.ts` (`nextVolume`, `nextToRead`),
  `defaults.ts` (`pickDefaultEdition`), `labels.ts`, `log-preview.ts`,
  `page-data.ts`, a `kinds` prop on `CatalogueDateField` and the reading-date
  mapping in `dates.ts`, and the `durtal-reading-home` preference.
- Actions: `getNextInSeries` and `findPageCount` (`src/lib/actions/reading.ts`).
- Keyboard: the R menu (`useReadingActions`, `READING_KEYS`: S, P, U, F, A, L,
  H) and a "Reading" group in the shortcut sheet; the palette's "This page"
  lists the reading actions by name.
- Rating input (from #94 review): "1 star", and a pointer event with no
  position (as a VoiceOver double tap may send) never changes the rating.
- The book page shows "Abandoned at" and "Resume this reading" when the latest
  read was abandoned, even after an earlier finished read.
- Docs 03, 04 and 06.

## Completion Notes

- Tests: unit `book-page-rules.test.ts` (at hand and where a copy is for every
  status, homes, `nextVolume`, `pickDefaultEdition` rule by rule) and
  `book-page-labels.test.ts` (labels and menus per state, Read N times, the log
  preview, partial dates, the record group); component `reading-dialogs.test.ts`
  (Log progress live line, move back and both choices, Undo payloads, the end
  opening Finish, another edition, keypad fields on touch; Finish and Abandon
  Undo; Start dialog positions, home, audio length and the digital copy at
  hand), `tiptap-editor.test.ts` (HTML opening, tools, HTML and JSON; the
  comment editor's tools and post), `rating-input.test.ts` (positionless
  activation, "1 star"), `reading-menu-shortcuts.test.ts`; database suite
  `book-page-reading.test.ts` (`atHandCopySql` agrees with `isAtHand` for 21
  copies at three places; `nextToRead` and `getNextInSeries`).
- `pnpm typecheck` clean; `pnpm deadcode` clean; `python3 scripts/qa/test-local.py`:
  171 files, 1941 tests, 0 skipped. `pnpm lint`: 0 errors, 82 warnings (one
  more than before: the R menu reads the page's actions the way the E menu
  does).
- Preview from `live-before-0064-0065-20261005-013641.dump`, seeded with
  `scripts/qa/reading-journey.sql` and one book per state.
- `node scripts/qa/journeys.mjs --disposable <preview> reading`: passes every
  step (start at p. 150 with "I'm at" Amsterdam; log 212 and +20; fix a log
  and Undo; go back; pause, resume, switch edition (p. 200 of 600 becomes
  p. 160 of 480); a sitting in the audiobook (the reading stays in its
  edition); finish with 4.5 and a review with bold and a link, Undo, finish
  again and see "Next in Journey Series: Journey Sequel, on your shelf in
  Amsterdam, Study, shelf 3"; re-read, abandon, Undo, abandon, Resume this
  reading; past reads in 2009 and from 14 Apr 2019 to Apr 2019; delete and
  Undo).
- Page weight, same preview, before (task 0303 code) and after: every main
  route the same size (`/library` 338 of 300 KB both times, `/` 299 of 300
  KB). A book page: 313.4 KB before, 317.2 KB after (within its 400 KB
  budget); 2666, already over budget, 494.9 KB before and 498.2 KB after. No
  Tiptap in the page's HTML: the dialogs load it on opening.
- Browsers, Chrome, Firefox 157 and Safari 26 at 1440, 768 and 390 px, on a
  book in each state and with each dialog open: the header control and the
  Read button are both 32 px with an 8 px gap; `alignment-audit.js` found the
  history rows' menus 3.8 px off their first line (fixed with `CapAligned`,
  then 0). Every other finding is the same before this change (the edition
  card's collection button beside its 21 px title, Safari's title-row icons
  0.55 px off). `design-audit.js`: 0 contrast findings.
- Touch in Chrome with touch emulation at 390 px: the control and Read button
  44 px, Log progress shows Page, % and Time with numeric keypads, no page
  overflow. With the zone set to America/Mexico_City, the default date is the
  Mexico City reading day. A comment posts and edits on the book page.
- Review fixes (#95): posting a comment no longer breaks the activity section
  (a collapse destroys the editor; the keyboard shortcuts skip a destroyed
  one; a test posts twice in a row with the section rendering again); the
  current reading's Log progress, Pause and Finish buttons are 44 px on touch;
  Edit reading refuses a page count that is not a whole number above 0 and an
  audio length it cannot read, with an error under the field, instead of
  clearing them. Checked in Chrome (two comments, Escape, 44 px buttons at
  390 px with touch), Firefox and Safari (two comments, the page count error);
  `test-local.py`: 174 files, 1955 tests.
- Not run: the iOS Simulator keypads and VoiceOver by hand. Edit reading has
  no start or current position fields: the update action from task 0302 does
  not take them; Log progress and its move-back choice change the position.

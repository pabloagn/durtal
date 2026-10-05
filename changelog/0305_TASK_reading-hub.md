# Task 0305: Reading hub, navigation, dashboard and palette

**Status**: Completed
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0304 (SLN-447)
**Blocks**: Reading tracker steps 5 to 15 (SLN-442)

## Overview

Step 4 of 15 of the reading tracker (SLN-442, sub-issue SLN-448). Reading has
a home: `/reading` shows what Joris is reading now and lets him log from
there, `/reading/journal` is his whole reading history, the dashboard shows
current and recent reads, and the command palette logs progress from any page
("212" logs page 212). `G R` opens Reading; the e-book reader stays its own
section. A book that is not in Durtal yet can be added and started in one
flow. No migration.

## Implementation Details

- Navigation: "Reading" (`/reading`, `BookMarked`) before the reader in
  `NAV_SECTIONS`; `G R` goes to it and the reader's entry has no key.
- `ReadingTabs` (`src/components/reading/reading-tabs.tsx`): the one tab row,
  in its final order (Now, Up next, Journal, Notes, Stats, Suggestions,
  Import); a tab shows once its page exists, so this step shows Now and
  Journal. 32px tabs (44px on touch), one line that scrolls inside itself.
- `/reading` (`src/app/reading/page.tsx`): Currently reading cards (cover,
  title, author, progress, "last read yesterday" in reading days, Log
  progress, a menu with Pause, Finish, Abandon, Open book), Paused ("paused 3
  weeks ago", Resume), Recently finished (six covers with the read's rating
  and date), and an empty state.
- `/reading/journal`: `parseJournalQuery` (`src/lib/reading/journal-params.ts`)
  and `queryJournal` / `getJournalFacets` (`src/lib/reading/journal.ts`):
  groups by year of finish or stop, the filtered summary, filters (status,
  year range, format, minimum rating, re-reads only, search) and sorts
  (finished, started, rating, title), 48 a page. The read's rating is
  `readingRatingSql`; a re-read is `rereadSql`, a new window in
  `src/lib/reading/summary.ts` over the order `readingOrdinalSql` numbers by.
- `ReadingDialogsProvider` (`src/components/reading/reading-dialogs-provider.tsx`)
  in both branches of `Shell`: `useReadingDialogs()` opens the reading
  dialogs and the book picker from any page. A dialog loads its book with
  `getReadingDialogData` and sends the caller's fingerprint.
- Book picker (`src/components/reading/book-picker.tsx`,
  `searchBooksToRead`): owned books first (`ownedBookCondition`, new in
  `src/lib/catalogue/holdings.ts`), reading states, and 'Not in Durtal? Add
  "<query>"' to `/library/new?q=` or `?isbn=` with `&then=start|past`
  (`bookPickerAddHref`, `src/lib/reading/book-picker.ts`).
- `/library/new` reads `q`, `isbn` and `then` (`addBookParams`); the wizard
  searches at once and both ways out to a book page carry `?then=`. A book
  page opened with `?then=start|past` opens that dialog once (`ReadingThen`)
  and takes `then` out of the address. The dialog opens first, then the
  address changes: a navigation while the dialog's data loads brought the old
  address back.
- Command palette: `PaletteItem.run` takes a function; a "Reading" group (Log
  progress per open reading, Start reading..., Log a past read...) and, first,
  smart items for a typed position (`paletteReadingItems`,
  `src/lib/reading/palette.ts`; "+20" stays relative). The open readings load
  each time the palette opens.
- Dashboard: Currently reading tiles (three at most) and Recently finished
  covers (four at most) after the Books block.
- Page weight: `RatingStars` is one SVG with the star path once (the same
  pixels, compared in Chrome, Firefox and Safari); the dashboard's reading,
  the finished covers and the journal's rows are client components with small
  props (`src/components/reading/reading-tiles.tsx`), and so is the
  dashboard's Recent people (`RecentPeopleGrid`, byte-identical markup).
  `/reading` and `/reading/journal` are in `scripts/qa/page-weight.json`.
- Log progress opened with a palette prefill keeps it in the one text field,
  also on touch, so "+20" is sent as typed.
- Docs 03, 04 and 06.

## Completion Notes

- Tests: unit `hub-rules.test.ts` (`parseJournalQuery` with every parameter
  and bad values, `bookPickerAddHref` and `addBookParams`, `paletteReadingItems`
  for pages, percents, "+20" as `addPages`, audio times, no and several open
  readings with their fingerprints, `readingTabs`, the hub's words);
  component `reading-hub.test.ts` (the picker's empty result and footer links,
  an ISBN, Log progress for a book being read, `ReadingThen` once and the
  address cleaned, the shell's dialogs on `/reader/12` and `/library`) and
  `add-book-query.test.ts` (the wizard searches the query or the ISBN at
  once); database suite `reading-hub.test.ts` (the read's rating with the
  three cases, the minimum rating and the Rating sort, re-reads with an
  abandoned first attempt and unknown dates, year groups at every precision,
  every filter and sort, the facets and fingerprints, the picker without
  accents, owned first, a deaccessioned copy not owned); the navigation test
  checks `G R`.
- `pnpm typecheck` clean; `pnpm deadcode` clean; `pnpm lint` 0 errors, 81
  warnings, none in the new files; `python3 scripts/qa/test-local.py`: 178
  files, 1990 tests, 0 failed.
- Preview of `live-before-0064-0065-20261005-013641.dump` with 3 books being
  read, 1 paused, finished reads at day, month and year precision, a re-read,
  an abandoned read and 60 more finished reads.
- Page weight on that preview, before (main) and after: `/` 297 KB before,
  288 KB after with three reading tiles and four finished covers (the
  lighter `RatingStars` and Recent people pay for them); `/reading` 73 KB;
  `/reading/journal` 257 KB with 48 rows; `/library` 338 KB before and 339
  KB after (over budget before this change; the sidebar's new entry is 1 KB
  on every page). Every other route within budget.
- Browsers, Chrome, Firefox 157 and Safari 26 at 1440, 768 and 390 px:
  `/reading` (cards of one height, tabs 32 px on one line, no page overflow),
  the journal (groups, 48 rows, filters open, a year range), the dashboard,
  the palette with "120" typed (first item "Log p. 120 · The Door") and with
  "+20" on `/reader/1`, the picker with no result and its link,
  `/library/new?q=Dune` searching, a book page with `?then=start` opening
  Start reading and cleaning the address, and the empty hub, journal and
  dashboard. Fixed on the way: finished covers six to a row overflowed at
  768 px (the date now sits under the stars), the cover link on a hub card had
  no name (removed; the title links), the Add book results' arrow was 3.7 px
  off its title (`CapAligned`), and the range filters' end years were
  `fg-muted` (now `fg-secondary`). Left as they were before this change: the
  edition cards' collection button beside its 21 px title, Safari's title-row
  icons 0.55 px off, the decorative monogram initials in `fg-muted`.
- `RatingStars` before and after, rendered side by side in each browser:
  identical in Chrome, at most 3/255 per channel in Firefox and 1/255 in
  Safari (antialiasing), the same gold and outline pixel counts.
- Touch (Chrome, 390 px): tabs, Log progress, the card menus, Resume, Start a
  book, the dashboard's Log and the journal's menus are 44 px; no overflow.
- Journey: `node scripts/qa/journeys.mjs --disposable <preview> reading`
  passes every step of task 0304's journey, then logs from `/reading`, logs
  "212" from the palette, filters the journal to 2009, and adds "Journey
  Loan" by hand from the picker's link, landing on its page with Start
  reading open and no `then` in the address.
- Not run: the iOS Simulator and VoiceOver by hand. The tab row's sideways
  scroll is in place but has nothing to scroll until later steps add tabs.

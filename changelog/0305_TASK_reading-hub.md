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

Filled in below after the checks.

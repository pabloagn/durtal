# Task 0507: One path between a book, its eBook and the reader, part 2

**Status**: In Progress
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0506
**Blocks**: None

## Overview

SLN-683, part 2. Part 1 (0506) gave every reader entry one link and one
vocabulary. This part gives the book page one way into the reader, makes the
eBook page a page under its book, and shows progress on the /ebooks cards.

## Implementation Details

- Book page (`src/app/(catalogue)/library/[slug]/page.tsx`): the eBook's Read
  button comes first, in the primary style (`CatalogueReadButton primary`).
  The reading control follows it. For a book with no reading it says "Not
  tracked" instead of "Start reading", matching the reader's own "Track this
  book" (`readingControlLabel(readings, { ebook })`). Its menu is unchanged.
- One percent per book everywhere (review decision, 14 Oct): the newest
  place past the opening page from any device. `continueTarget` returns it as
  `bookPercent`, and `catalogueReadLabel` shows it as "Continue · 34%" with
  the reader's `formatPercent` (#229: whole, one decimal below 10%, rounded
  down), so nothing reads 100% before the last screen. The book
  page, the eBook page, the /ebooks cards and Continue reading on /ebooks all
  show that number. A place on the opening page (`opened`, new in
  `continue-target.ts`) is only an open, and the button says "Read".
- Read still opens at this device's own place when it has one, with the
  read-elsewhere offer (#226) when another device is further on, so the
  percent can be ahead of where the reader lands.
- eBook page (`src/app/(catalogue)/ebooks/[ebookId]/page.tsx`):
  - titled after its linked book, with the book's authors;
  - a breadcrumb "eBooks / Against Nature" with the book linked;
  - the line under the title says "The eBook of this book", and names the
    file's own title when it differs;
  - the tab title is "Against Nature · eBook".
  - The linked book is read once and handed to `EbookLinkPanel` (new
    optional `book`).
  - Read and "Read the PDF" are `ReaderEntryLink`s that return to the page.
- /ebooks cards: the listing query adds `progress`, the newest place on any
  device that is past the opening page. Cards show it with `fractionPercent`
  beside the linked mark.
- The book page's sessions toggle (`session-list.tsx`) wrapped at 320 px with
  its chevron 10 px below the first line. The chevron now sits on the first
  line (`CapAligned`), with the line centred in the 32 px row.
- `scripts/qa/journeys.mjs` (ebooks):
  - the book page has Read first and no "Start reading" beside it;
  - the eBook page is titled after its book.

## Completion Notes

- Checked headless in Chromium, Firefox and WebKit at 1440, 390 and 320 px on
  the book page, the eBook page and /ebooks. The alignment, design and
  overflow audits are clean, and the ebooks journey passes.
- Left for later:
  - the book page's copy row still shows the copy's single format chip
    ("EPUB") beside an eBook with EPUB and PDF;
  - the eBook's highlights and Reading places are reachable from the book
    page only through the eBook page;
  - eBook results in the command palette;
  - the /ebooks grid card is still titled with the eBook's own title.
  - Quotes as one feature is SLN-664, which waits for its migration decision.

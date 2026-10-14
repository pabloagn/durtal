# Task 0586: One path between a book, its eBook and the reader, part 3

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0507
**Blocks**: None

## Overview

SLN-683, the four items 0507 left: the book page's copy row showed the
copy's one format chip beside an eBook with EPUB and PDF; the eBook's
highlights and reading places were reachable from the book page only through
the eBook page; the command palette listed only unlinked eBooks; and the
/ebooks cards were titled with the eBook's own title.

## Implementation Details

- **Copy row** (`instance-detail.tsx`): a copy that is an eBook shows one
  chip per format the eBook has ("EPUB", "PDF"), not the format the copy
  was entered with. `CopyEbook.formats` is now a list.
- **Highlights and reading places from the book page**: the copy's Digital
  block adds "Highlights" ("3 highlights · 1 note", to
  `/ebooks/highlights?ebook=…`) and "Reading places" ("On 2 devices", to the
  eBook page's Reading places section), each only when there is something.
  `getEbookReach` (`src/lib/ebooks/highlights.ts`) counts both for the book's
  eBooks in one query.
- **/ebooks cards and rows**: a linked eBook goes by its book's title and
  authors, as Continue reading already did. The listing joins the linked
  book (`linkedBook` in `library-queries.ts`, now shared with Continue
  reading) and `ebookCardData` uses it.
- **Command palette**: the eBooks group also lists a linked eBook, under its
  book's title, when its book is not already among the Books results
  (`paletteEbooks`, `ebookPaletteGroup`), so an eBook found by its own file
  metadata leads to its book's name. Palette rows are 44px tall on touch
  (they were 36px, on main too).

## Completion Notes

- Tests: `ebook-card` (a linked card takes its book's title and authors),
  `catalogue-policies` (a linked eBook is listed only when its book is not a
  result) and `ebook-library` in PostgreSQL (the listing's book columns and
  `getEbookReach`'s counts).
- Checked on a disposable preview with an eBook of two formats, three
  highlights, a note and places on two devices: the alignment, design,
  overflow and touch audits are clean on the book page, /ebooks as grid and
  list, and the palette with results, in Chromium at 1440, 768, 390 and 320
  and in Firefox and WebKit at 1440 and 390 (32 renders). Page weight passes
  (the book page 132 of 400 KB). The ebooks journey passes.
- Sorting /ebooks by title still sorts by the eBook's own title, so a linked
  card can sit out of order under its book's title. Sorting by the book's
  title needs the join inside the paged query, which the 7,000-row
  bounded-page check covers; left as is.
- /ebooks/highlights still names each eBook by its own title.
- No migration and no new packages.

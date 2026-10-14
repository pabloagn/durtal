# Task 0506: One path between a book, its eBook and the reader (part 1)

**Status**: In Progress
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0503
**Blocks**: None

## Overview

SLN-683, from the 13 October e-book review: the reader's Back said one page
and went to another, /ebooks "Continue reading" listed finished books and
books only opened, under the e-book's own title, the reading hub's "Open
eBook" was a small underlined link that lost its way back, and the eBooks
search did not find a linked e-book by its book's title or author.

## Implementation Details

- Reader Back (`reader-view.tsx` `onBack`): goes back through history only
  when the page it came from is the page the link names (path and query);
  otherwise it follows its own link. Every entry below now names its page.
- Every reader entry from /ebooks, the hub and the dashboard is a
  `ReaderEntryLink` (a document link, so the reader gets its CSP) with a
  return route: the /ebooks grid and list (with their filters and page),
  Continue reading (`/ebooks`), the hub card (`/reading`) and the dashboard
  tile (`/`).
- Continue reading (`getContinueReading`): only places that are underway
  (`underway()` in `continue-target.ts`: past the first page of the first
  section and before 99.5%); a linked e-book goes by its book's title and
  authors (lateral join on the copy's work); the card shows the author, a
  whole percent and when, no device or browser; on a phone a card is the cover
  beside its text, 288 px wide, so the row stays one line that scrolls.
- Command palette: Continue reading names the book's title.
- eBooks search: each word also matches a linked e-book's book title,
  original title and authors (`ebookLibraryWhere`).
- Reading hub card: "Open eBook" is a secondary button before Log progress;
  the card is a container whose actions drop under the cover when it is
  narrower than 280 px (it overflowed at 320 px).
- Names: "Reading places" for an e-book's saved positions; "eBook" in the
  integrations, runs, sessions and pace text. The reading-import source
  "E-book library" and the ingest and review reasons are stored with the
  data, so they keep their wording.
- `scripts/qa/journeys.mjs ebooks`: book page, /ebooks, an eBook page,
  Continue reading and the hub's Open eBook each open the reader, and Back
  lands where its link says.

## Completion Notes

- Left for part 2: one primary reading action on the book page ("Start
  reading" beside "Read"), the eBook page titled after its book as a clearly
  secondary page, progress and linked state on /ebooks grid cards, Continue
  counting every device.

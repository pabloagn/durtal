# Task 0505: One way to name a place in a book

**Status**: Completed
**Created**: 2026-10-13
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-680: the contents, the scrubber, the bottom bar, the margins, bookmarks
and Places named the same place in different ways. Every part of a chapter
showed the page before it, the scrubber named the next page while the bar
named the current one, percentages came in four formats, and a comic's
contents listed archive file names ("001.jpg").

## Implementation Details

- `src/lib/reader/place-label.ts` is the one formatter: `formatPercent`
  (whole numbers, one decimal below 10%, rounded down so a book never shows
  finished early), `fractionPercent`, `pageWords` ("p. 7 of 32", "p. iv",
  "Page 3 of 6" in a fixed-layout book), `locationWords` ("Location 6 of
  16") and `samePlace` (a heading that only repeats the page beside it).
- `PositionIndex`:
  - `pageWords`, `positionLabel` and `locatorLabel` use it;
  - new `entryPage(href)` gives the page a contents entry starts on: the next
    page marker when it falls within about one page of the entry, in the same
    section, else the page in force;
  - `preview` drops a chapter that repeats the page.
- `running-lines.ts` `pageText` is now `index.locatorLabel`, so the margins and
  the bar say the same thing.
- `ProgressScrubber` takes a `restLabel`: at rest its value text is the bar's
  own line (chapter, page, percent); a drag or a key still previews by
  fraction. Foliate reports the end of the visible spread as the fraction, so
  the preview named the next page.
- Contents: entry pages from `entryPage`, percentages through
  `fractionPercent`; titles wrap in full (was a fixed two-line clamp that also
  made every row two lines tall); chevron, title and page share the first
  line (`items-baseline`, the chevron in `CapAligned`).
- Comics: vendored `comic-book.js` names contents entries "Page N" (Durtal
  patch 21 in `VENDORED.md`); the bar and contents do not repeat the page.
- Percentages on the e-book page, Continue reading, Places, highlight groups,
  the annotations panel, the announcer and `read-target` all go through
  `formatPercent`.

## Completion Notes

- Unit tests: `src/__tests__/reader/place-label.test.ts`.
- Checked headless in Chromium, WebKit and Firefox at 1440 and 320 px on the
  page-map, page-list, long, comic and RTL books, with long injected titles:
  chevron 0.19 px from the first line's cap centre, page numbers on the first
  baseline. Alignment, design and overflow audits clean apart from the side
  panel close button (1.7 px), fixed separately in batch 4.
- Percent stays the end of the visible spread (`totalProgression`), so a tiny
  book can show "Location 1 of 16 · 17%"; in a book of normal length the gap
  is under one page.

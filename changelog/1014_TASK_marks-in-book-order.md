# Task 1014: Highlights and the Markdown export list marks in book order

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1000 and SLN-1001, from the notes survey. On /ebooks/highlights, a
book's marks ran by last edit, so marks at 70%, 60% and 10% listed in
whatever order they were last touched. The Markdown export grouped marks
by chapter name, so every mark without a chapter went under one "No
chapter" heading placed where the first such mark fell, ahead of chapters
that come before it.

## Implementation Details

- `src/lib/ebooks/highlights.ts`: within a book, marks are ordered as the
  reader's panel orders them (`compareBookPlaces`): section, then the CFI
  read as numbers, then progression, then id. The CFI's steps are read in
  SQL the way `cfiPlace` reads them, once per mark through lateral joins,
  so paging with `?ebook=` follows the same order. Books still come newest
  first, or by title.
- `src/lib/reader/export.ts`: the export walks the marks in book order and
  starts a heading whenever the chapter changes, so a heading repeats when
  the book comes back to it.

## Completion Notes

- `ebook-highlights.test.ts` (database): marks made out of order, the
  first one edited last, two of them a page apart with reversed
  progressions: listed in book order filtered to the book, paged, and
  unfiltered. It fails on main.
- `export.test.ts`: chapterless marks on either side of a chapter get a
  heading each, in book order. It fails on main.

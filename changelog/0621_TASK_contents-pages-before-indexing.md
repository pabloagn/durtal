# Task 0621: Contents names no page it does not know yet

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

For the first seconds after a book opened, Contents gave every entry its
chapter's last page: in the EPUB 3 fixture, Chapter 1 and its Parts 1 to 4
all said 8, Chapter 2 and its parts all said 16, and so on. When the
background index finished, the right pages (1, 2, 4, 6, 7, 9...) replaced
them under the reader. A book without a page list had the same fault in
percent: every part showed its chapter's percent. Contents now leaves the
number out until it is known. SLN-724, from the reader audit of 15 Oct.

## Implementation Details

- `src/lib/reader/position-index.ts`:
  - `placed(href)` is true for an anchor the index has placed, and for a
    file's own start, which needs no indexing.
  - `entryPage` names no page while the entry, or any page marker in its
    section, is unplaced. Every unplaced anchor stands at its section's
    start, so the last marker there won.
- `src/components/reader/contents-panel.tsx`: without a page list, the
  percent shows only for a placed entry.
- The panel already re-renders when the finished index is published.
- Test: `src/__tests__/reader/place-label.test.ts`, "contents pages before
  the book is indexed".

## Completion Notes

- EPUB 3 fixture at 1440 px, local index cache cleared, Contents opened at
  once and read every half second:
  - before, in Chromium, WebKit and Firefox: 8, 8, 8, 8, 8, 16, 16... for
    two seconds, then the right pages;
  - after: no numbers, then the right pages after 1.5 to 2 seconds, with no
    wrong number in between.
- Alignment, design, overflow and touch audits on Contents with the EPUB
  and the PDF, Chromium and WebKit at 1440 and 390: no new issues (only the
  Highlights panel's "All highlights" link, SLN-726).
- No migration and no new packages.

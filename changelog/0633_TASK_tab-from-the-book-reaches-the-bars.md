# Task 0633: Tab from the book reaches the bars

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-810, found while checking the reader against its reading rules. With
focus inside a book's page, Tab went to the book's links, then off the page
in ways that depended on the browser: Firefox never left the book, Chromium
could stop on the page body or on part of a PDF's drawing before reaching the
bars, and Tab could move to a link on another page, turning the book under
the reader. Now Tab visits the links on this screen, then moves to the page
buttons and the bottom bar; Shift+Tab goes back to the top bar. The hidden
bars come back with the focus. Chromium, WebKit and Firefox.

## Implementation Details

- `src/lib/reader/book-tab.ts` (new): `tabbables()` lists what Tab visits in
  a document; `nextInBook()` picks the next (or, with Shift, previous) one
  on screen after the focused element, or null when none is left;
  `besideBook()` picks the reader control after the book in the page, or
  before it with Shift, coming round at either end.
- `src/lib/reader/input.ts`: a `bookTab` option hears Tab pressed inside a
  book's page (not the reader's own document) when the selection's toolbar
  did not take it.
- `src/app/reader/[ebookId]/reader-view.tsx`: `bookTab` takes every Tab in
  the book. It moves to the next link on screen without scrolling; with none
  left it shows the bars and moves to the control beside the book.

## Completion Notes

- Chromium, WebKit and Firefox at 1440, with EPUB, PDF and MOBI: click into
  the text, then Tab visits the links on screen, then Previous page, Next
  page and the bottom bar; Shift+Tab from the text reaches the top bar's last
  control. The place does not change. Before, Firefox stayed in the book.
- Left for later: Shift+Tab from the top bar back into the book lands on the
  page itself rather than its last link.
- `reader-engine-check.mjs`: 278 of 278 rows pass (one Chromium blank-frame
  row, which caught 3 frames while a build ran beside it, passed on its own
  re-run). 0 alignment and design-audit findings on the reader (EPUB and
  PDF) in all three engines at 1440, 390 and 320; `page-weight.js` within
  budget.
- Tests: `book-tab.test.ts` covers the three helpers; `input.test.ts` checks
  that Tab in a book's page reaches `bookTab` and that the selection's
  toolbar keeps it first. The second fails without the fix.
- No migration and no new packages.

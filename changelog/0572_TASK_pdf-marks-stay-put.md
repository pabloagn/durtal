# Task 0572: PDF marks stay put, and the check covers quotes, zoom and Go to mark

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0502
**Blocks**: None

## Overview

The rest of SLN-670. PDF highlights were already drawn (0502), but every
open of a PDF wrote each of its marks back to the server unchanged, a mark
on a replaced file never came back when any other page was long, and the
automated check covered one highlight at 1440 only.

## Implementation Details

- `src/lib/reader/annotation-controller.ts`: a resolved mark is written back
  (`reanchor`) only when its place really changed. The comparison was
  `JSON.stringify`, and a PDF mark's measured locator lists its fields in
  another order than the stored one (`pdf` after `totalProgression`,
  `before` before `highlight`), so every PDF mark was rewritten on every
  open: 35 writes for the fixture's 35 marks, each time. It now compares the
  two as JSON values whatever their key order, with a PDF mark's rectangles
  allowed two points apart and its reading position 0.001: each browser
  measures the text a little differently (0.98 pt and 0.0003 seen), so opening the book on another device rewrote every
  mark, and two windows in two browsers rewrote each other's (review).
- `src/lib/reader/engines/foliate/pdf-annotation-resolver.ts`: on a replaced
  file the resolver looks for the mark's words page by page. A page whose
  bounded fuzzy search would cost too much returned "pending" for the whole
  mark, so it waited forever on any book with a long page. Such a page is now
  noted and the scan goes on: an exact copy of the words, and of the words
  around them, elsewhere still heals the mark, and any other mark keeps
  waiting. The words alone are not enough: they could be a passage that
  repeats, with the mark's own copy on the page that was not searched
  (review).
- `scripts/qa/reader-engine-check.mjs` `pdfmarks`: at 1440 and 390 in the
  three browsers, a highlight and a saved quote made on the PDF fixture are
  drawn on their text (each rectangle within a fifth of a line of it, an
  underline in the line's lower half), and again after a reload; at 1440
  the selection toolbar sits beside the selection, the marks stay on their
  text after zooming in twice, and Go to mark from three pages on draws the
  highlight. Each new mark is found by the id the reader saved, not by what
  happens to appear on the page.

## Completion Notes

- `pdfmarks`: 25 of 25 rows pass in headless Chromium, Firefox and WebKit on
  a fresh preview (Chromium three times in a row).
- Opening the PDF fixture with 36 marks now sends no annotation writes (main
  sends one per mark on every open).
- Tests: `annotation-controller.test.ts` (no write for a reordered place,
  or for rectangles 0.98 pt and positions 0.0003 apart; one for a 6 pt move; each fails without
  its fix), `pdf-consumers.test.ts` (an exact quote heals while a long page
  defers; a near quote, or the same words with other words around them,
  still waits).
- No migration and no new packages.

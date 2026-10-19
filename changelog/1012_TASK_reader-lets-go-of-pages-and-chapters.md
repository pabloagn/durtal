# Task 1012: The reader lets go of the pages and chapters it no longer shows

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1291 and SLN-1292. Reading on kept every page or chapter the reader had
shown alive, so memory grew with every turn: a long PDF, a comic or an EPUB
read for an evening slowed the tab and could end it. Two causes, both found
and measured by the third reviewer.

## Implementation Details

- `src/lib/reader/history-input.ts` (SLN-1291): the history keys and mouse
  buttons are attached to every document the reader loads, and the remover
  of each was kept in a set until the reader closed, holding its document.
  The documents are now held weakly, as `input.ts` already holds them, so a
  page or chapter the renderer let go of is collected.
- `src/vendor/foliate-js/paginator.js` (SLN-1292, Durtal patch 31 in
  `VENDORED.md`): views before the primary chapter were never trimmed, so
  every chapter read stayed loaded. `#trimPassedViews` keeps the chapter
  just before, which a spread or a back turn can show, and in scrolled mode
  what lies within ten screens above; it unloads the rest and moves the
  scroll position back by the space they took. The primary chapter usually
  changes mid-turn, while the trim waits out the animation, so it runs
  again once the turn settles.
- `scripts/qa/reader-memory.mjs`: a guard. Headless Chrome reads the 4-page
  text PDF, the 300 MB scanned PDF and the 100-chapter EPUB (paginated and
  scrolled) for 300 turns, and measures at 20 and at 300 after three forced
  garbage collections: documents, nodes, JS heap and chapters loaded. It
  fails when documents grow by more than 2 or an EPUB keeps more than 3
  chapters paginated or 4 scrolled, and checks that a highlight in a
  chapter the reader unloaded is drawn again after a back turn into it.
- `src/__tests__/reader/navigation-ui.test.ts`: destroying the history input
  still stops it on every attached document.

## Completion Notes

- `reader-memory.mjs`, production builds, private previews:

  | Book | Main | This change |
  | -- | -- | -- |
  | 4-page text PDF | 15 to 155 documents, 14.9 to 44.2 MB | 6 to 6, 12.9 to 13.9 MB |
  | 300 MB scanned PDF | 42 to 602 documents, 19.9 to 131.1 MB | 5 to 6, 12.7 to 14.6 MB |
  | 100-chapter EPUB, paginated | 4 to 21 documents, 19 chapters loaded | 5 to 6, 3 chapters loaded |
  | 100-chapter EPUB, scrolled | 4 to 13 documents, 10 chapters loaded | 5 to 6, 2 chapters loaded |

- A highlight made in a chapter, unloaded after reading on and drawn again
  after the back turns into it, in Chromium (unloaded after 23 turns),
  Firefox (16) and WebKit (17). Headless WebKit here ends a page that stops
  answering while the machine is busy, on main as on this change, so its run
  was made with nothing else running.
- Not fixed, re-measured as the reviewer asked: the 4-page PDF read back and
  forth still adds nodes (877 to 1,997 over 280 turns) while its documents
  stay at 6; `pdf-raster-renderer.ts` keeps a hidden page's entry until it
  is retired.

# Task 0575: A saved place reopens on the same side of the spread

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0564
**Blocks**: None

## Overview

On a wide screen the reader shows two pages side by side, and a chapter can
begin on the right-hand page of the previous chapter's last spread. A place
saved there, or anywhere after it in the chapter, often reopened one page
off: the first words read were on the right, with the page before them on
the left, so the reader seemed to open a page early. Firefox also took its
first place before the book's fonts arrived. SLN-696.

## Implementation Details

- `src/vendor/foliate-js/paginator.js` (Durtal patch 29, `VENDORED.md`):
  - The side a page takes depends on every chapter loaded before it, not
    only the previous one: each chapter with an odd number of pages flips
    the sides of the chapters after it. Reading on from the start keeps all
    of them loaded; a reopened book loaded only the saved chapter.
  - `#alignSpreadStart`: after a navigation to a collapsed point (a saved
    place is the point where a screen began), if the point sits on a later
    page of its spread, earlier chapters load one at a time, at most four,
    until it begins the spread. It runs on a first display and on a
    navigation within the loaded strip. The page is measured against the
    screen as scrolled, so it also catches the strip's last spread, which
    the browser cuts short: a place on a chapter's last page first loads the
    next chapter (which loads right after anyway).
  - A jump to a chapter, a mark, a search result or a link is unchanged, so
    a chapter opened from Contents still starts on a left-hand page.
  - `#display` waits for the view's `fontReady`, at most one second, before
    anchoring, so Firefox no longer reports a place laid out on a fallback
    font.
- The decision to keep chapters able to begin on a right-hand page stands;
  chapters are not forced to start on a left page.

## Completion Notes

- Spread reopen check (scratch script): 1440 px, turn one to three pages,
  wait for the save, reopen, compare the first words, 20 rounds each in
  Chromium, Firefox and WebKit on the navigation fixture.
  - main: 24 of 60 rounds reopened one page off.
  - Loading only the previous chapter first: 8 of 60, because the fixture's
    13-page chapters flip the sides and one chapter is not enough.
  - This change: 0 of 60.
- Review: a race. While the earlier chapters load, the scroll their
  insertion causes could be taken as a move, replace the saved place and stop
  the alignment before it scrolled back (seen once in WebKit and once in
  Chromium on a slowed CPU). That scroll is now held back while the chapters
  load (`#aligningSpread`). The reviewer's 20 slowed reopens landed right.
- The spread check is now a row of the reader engine check (`place`, "1440
  spreads"): twelve reopens after one to three turns.
- Reopens that need an earlier chapter take about 0.6 s longer (570 to
  1150 ms), an accepted trade-off.
- No migration and no new packages.

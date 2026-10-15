# Task 0636: Tab into the book stays on the screen

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0633
**Blocks**: None

## Overview

SLN-826, from the review of #389. Tab from the top bar's last control, or
Shift+Tab from Previous page, followed the browser's own order into the book's
frames, which hold more than the current screen. Focus could land on a link
in another chapter or further on, and the browser scrolled the book to it:
Chromium in chapter 3 jumped to chapter 1, WebKit to chapter 2, Firefox went
back a screen, and cycling round the reader with Tab did it too. Now Tab into
the book lands on the screen's first link, Shift+Tab on its last, or on the
page itself when the screen has none, and the place never moves.

## Implementation Details

- `src/lib/reader/book-tab.ts`: `entersBook()` says whether the book is the
  next stop from a reader control in the direction of travel; `enterBook()`
  picks the first link on screen going forward, or the last going back,
  across the sections drawn now; `onBookScreen()` is the on-screen test
  0633's in-book Tab already used, now shared.
- `src/lib/reader/input.ts`: a new `intoBook` option hears Tab pressed on
  the reader's own page; Tab inside a book's page still goes to `bookTab`.
- `src/lib/reader/engine.ts`, `engines/foliate/engine.ts`: `bookDocuments()`
  gives the drawn sections' documents in reading order.
- `src/app/reader/[ebookId]/reader-view.tsx`: when the book is next, Tab is
  taken; focus goes to the link without scrolling, or to the page itself
  through `focusBook()`, from where 0633's `bookTab` takes the next press.
  Firefox moves focus into a frame only once the frame has it, so the frame
  is focused first.

## Completion Notes

- Test book: the EPUB 3 fixture rebuilt locally with a link in every
  paragraph of chapters 1 and 2 (96 links, L1-01 and on), served only to a
  local preview and not committed.
- Chromium, WebKit and Firefox at 1440 and 390, reading in chapter 1 (second
  screen) and in chapter 3: Tab from the top bar's last control lands on the
  screen's first link (L1-08/L1-09 at 1440) or on the page in chapter 3;
  Shift+Tab from Previous page lands on the screen's last link (L1-15/L1-16)
  or on the page; 40 Tabs and 40 Shift+Tabs round the reader never move the
  place. With the reader's handler held back, as on main, the same probe
  moved Chromium from 0.07 to 0.035 and from chapter 3 to 0.035, and Shift+Tab
  from Previous page to 0.246.
- Firefox, as on main: Tab past the last control and Shift+Tab past the first
  leave the page for the browser's own controls rather than coming round.
- PDF in all three engines at 1440: Tab from the top bar's last control lands
  on the page, then Previous page and the bottom bar; the place does not move.
- 0 alignment and design-audit findings on the reader (EPUB and PDF) in all
  three engines at 1440, 390 and 320; `page-weight.js` within budget.
- Tests: `book-tab.test.ts` covers `entersBook()` from both bars and
  `enterBook()` with links off screen in the same and other sections;
  `input.test.ts` covers the routing; `reader-view.test.ts` presses Tab on
  the top bar's last control and Shift+Tab on Previous page and fails without
  the handler.
- Also covers 0633's "Not covered yet": Shift+Tab back into the book now
  lands on the screen's last link rather than the page.
- No migration and no new packages.

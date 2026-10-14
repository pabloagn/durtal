# Task 0508: Reader jumps, links and browser history

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-681, from the e-book review of 13 Oct. After every jump the reader drew
a 2 px focus box around the paragraph it landed on, book links kept the
browser's default blue, and following an in-book link added no browser
history entry, so browser Back left the reader.

## Implementation Details

- Focus box (`src/lib/reader/presentation.ts`): the place a jump or the
  reader moves focus to carries `tabindex="-1"`, which is not a keyboard
  stop, so both book stylesheets now draw no outline for it. Links and other
  real focus stops keep the existing `:focus-visible` outline.
- Links (`src/lib/reader/presentation/book-css.ts`): `a:any-link` takes the
  theme's link colour, underlined, over the book's own colours. Sepia and
  paper's link colours fell short of 4.5:1, so `linkInk` fits them with
  `fitContrast`. `PublisherInk`
  (`src/lib/reader/engines/foliate/publisher-ink.ts`) skips links: in a book
  with no link style it had copied the browser's default blue as the link's
  own ink.
- Browser history (`src/lib/reader/browser-history.ts`, new):
  - every jump that adds an entry to the reader's own history
    (`ReaderHistory.appended`, `pushed` in `createReaderNavigation`) pushes
    a browser entry for the same address;
  - browser Back, a mouse back button or Android back then steps the reader
    back through popstate;
  - the Back chip and Alt+Arrow step through the browser while it holds the
    entry, so the two never drift apart.
  - Entries carry a token per open, so entries left by an earlier open of
    the book are not this reader's.
  - A reload takes over the token and depth the browser kept in
    `history.state` and starts above them (`floor`), so the reader's Back
    still leaves past every in-book entry. Browser Back into an entry from
    before the reload goes on to the page the reader was opened from, and a
    popstate on another address is ignored (review of #235).
- Leaving the reader (`reader-view.tsx`): its Back goes past the in-book
  entries to the page the reader was opened from
  (`history.go(-1 - depth)`).

## Completion Notes

- Checked headless in Chromium, Firefox and WebKit at 1440 px, and browser
  Back, Forward and the chip again at 390 px:
  - two contents jumps, then browser Back, browser Forward, Alt+Left, the
    Back chip and browser Back again land on the expected places in order;
  - after the reader's start, browser Back leaves the reader.
  - From the eBook page, the reader's Back after two jumps lands on the eBook
    page, and browser Forward returns to the reader.
- The MOBI fixture's links read in the dark theme's accent, rgb(140, 159,
  174), underlined, in all three browsers (they were the default blue). After
  a jump the focused element has no outline. A unit test covers the link
  rules for every theme at 4.5:1.
- The alignment, design and overflow audits are clean on the EPUB and MOBI
  books with the chip showing, at 1440, 390 and 320 px.

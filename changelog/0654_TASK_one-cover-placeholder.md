# Task 0654: Every blank cover shows the title's letter

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Design-polish pass of 15 Oct (findings/design-polish-2026-10-15.md, item 3).
A book with no cover looked different from page to page:

- the library's, a person's and a series' cards showed the title's first
  letter in the serif;
- the Reading pages (Now, Up next, Journal, Suggestions, the year page,
  Import) and a collection's items showed a small book icon;
- the book page's reading card showed an empty box;
- its edition card said "No cover".

The book page alone had three of the four.

## Implementation Details

- `src/components/books/cover-letter.tsx` (new): `CoverLetter` is the title's
  first letter in the serif, `fg-muted` at 30%, decorative. `COVER_BLANK` makes
  the box the `cover` size container. The letter keeps to the type scale as
  the box grows: 14px under 56px wide, 21px from 56px, 38px from 120px (a
  card's cover, the size the library's cards already used). Its line is
  trimmed to the cap height and baseline (`text-box`), so the box centers
  the capital: on its line box the serif sat 0.1em above the middle.
- `book-card.tsx`: `CoverPlaceholder` draws it, so the library's cards look as
  before.
- `reading-tiles.tsx`: `Cover` takes the title and draws the letter instead
  of the book icon. Every caller passes its title, except the timer chip,
  whose tiny thumb stays blank (docs/03, Reading timer chip).
- `edition-cover.tsx` (`EditionImageBox`): the letter replaces "No cover"; the
  box still names "<title>: no cover" to a screen reader.
- `reading-section.tsx`: the book page's reading card draws the letter on its
  blank.
- `collections/[id]/page.tsx`: a member with no image draws the letter on the
  `bg-tertiary` blank, filling its frame.
- `docs/03_DESIGN_LANGUAGE.md`, Cards without a photo: the rule.
- Tests: `src/__tests__/ui/cover-letter.test.ts`; `ordinary-detail-resources`
  checks the edition box's letter and label.

## Completion Notes

- Measured every blank cover box on a production preview of a disposable
  seed database, against main, in Chromium, Firefox and WebKit at 1440 and
  390 (touch at 390). Pages: Reading Now, Up next, Journal and Suggestions,
  the book page, a collection, Books and a person.
  - On main: 36 book icons at 1440 on the Reading pages, one empty box and one
    "No cover" on the book page, 9 icons in the collection.
  - On this branch every one is the letter. Sizes: 14px in 32 and 44px
    thumbs, 21px in 56 to 109px boxes, 38px from 171px. Each capital is
    centered in its box: measured on the glyph's cap height, at most 0.4px
    off (it was 1.5 to 4.5px high, the library cards' letters included,
    before the line was trimmed).
  - Library and person cards are unchanged (38px, centered).
- Alignment and overflow audits are clean, the design audit finds no
  low-contrast text, and every page uses only the seven sizes.
- `page-weight.js` passes. Typecheck clean, lint no new warnings, UI tests
  pass (108 files). No migration, no new package.

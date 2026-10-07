# Task 0359: /library under its page-weight budget, with headroom

**Status**: Completed
**Created**: 2026-10-07
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-524. `/library` measured 307,114 bytes on the production build: 299.9 of
its 300 KB budget (`scripts/qa/page-weight.json`). The next change to the page
would have failed `scripts/qa/page-weight.js`. This task trims the page's HTML
without raising the budget and without any visible change.

## Implementation Details

The page is 48 book cards. Each card's markup was about 4 KB, and the props
sent for the cards were 36 KB of the React Server Components payload.

- **Short classes for a card's repeated parts** (`globals.css`). A long
  Tailwind list that every card repeats becomes one utility, as `fade-image`
  and `icon-hit` already are. The CSS rules are the same.
  - `work-card`: the frame of every work card. `WORK_CARD`
    (`work-card.tsx`) is now `work-card group card-interactive`, so the film,
    perfume and painting cards and the home page's tiles get it too.
  - `cover-image`: a book card's cover image (`CoverImage`).
  - `card-copy-slot` and `card-menu-slot`: the copy and actions chips at the
    cover's bottom right (`BookCard`).
- **No empty fields in the cards' props** (`library/page.tsx`).
  `withoutEmpty` leaves out a null, an unset reading and a false flag. A
  false `isFavourite` stays, as it still shows the star. The crop is sent
  only when it changes the image: `mediaImageStyle` draws the default crop
  as no crop.

## Completion Notes

- Measured on a production build served on the newest backup,
  `live-before-0078-20261007-033858.dump` (`preview-local.py --start
  --from-dump`), on the first page of `/library` (48 books, sorted by title):
  307,114 B before and 283,255 B after, 276.6 of 300 KB. The classes saved
  13,920 B and the props 9,939 B. Every route in `page-weight.json` passes.
- No visible change. With each cover served (placeholder files in the
  preview's S3 folder), every element's box and computed style in `main` was
  recorded on `/library`, `/`, `/films`, `/perfumes` and `/paintings`, before
  and after, at rest and with the first card hovered. In headless Chrome,
  WebKit and Firefox, at 1440 px with a mouse and at 390 and 900 px with a
  coarse pointer, no element differs.
- The same three browsers on those five pages: `touch-audit.js` at 390 px
  with a coarse pointer finds nothing new and no two `touch-hit` areas
  overlap; the alignment and design audits at 1440 and 390 px find nothing.
  The one touch finding, the 28 px "Adjust collection poster" on `/`, is
  SLN-523 and unchanged here.
- `scripts/qa/test-local.py`: 250 files, 2,778 tests, all passed. Typecheck clean;
  lint warnings only, as on main.

# Task 0694: Suggestions and the journal stay under their page budget

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-809, from the #370 review (`findings/review-pr-370.md`, notes) and the
weight survey (`findings/weight-headroom-2026-10-15.md`). With a library of
about 800 books, `/reading/suggestions` was over its 300 KB budget, and
`/reading/journal` was close to it. Joris's library is that size.

On Suggestions, about half of each row was its "Why this?" popover: every
feature's bar, reason and evidence links, hidden until the button opens it.
Pick one for me also received each of its ten books' full rows, Why this?
included. On the journal, every row drew its rating's star path, its format
icon and its menu icon in full.

## Implementation Details

- `src/components/reading/suggestions/why-this.tsx`: the popover's content
  renders the first time it opens, synchronously, so it is placed at its real
  height. It renders on `beforetoggle`, or on `toggle` where a browser lacks
  it. The button and the empty popover stay in the page.
- `src/lib/reading/suggest/view.ts`: a row's Why this? evidence keeps its
  label and link, without the id the API returns. `pickRow` gives Pick one
  for me only the fields a draw shows (`PickRow`).
- `src/components/ui/sprite-icon.tsx`:
  - `IconSprite` adds these Lucide icons: ellipsis, list-plus, clock,
    book-text, tablet and headphones.
  - It also adds the star path (`i-star`) and the half-star clip
    (`i-star-half`).
- `src/components/shared/rating.tsx`: `RatingStars` draws its five stars
  from `i-star` instead of its own copy of the path.
- The rows draw their icons from the sprite:
  - the suggestion row's Add to Up Next, Not now and menu;
  - the journal row's format icon (`reading-tiles.tsx`) and menu
    (`hub-actions.tsx`).

## Completion Notes

Production builds of main (6ce1251f) and of this change, each served on the
same local preview database. The database came from one dump: the synthetic
catalogue, the demo books, the reading journey and the #370 review's library
seed (806 books). Weight from `page-weight.js`:

| Route | main | this change | Budget |
| --- | --- | --- | --- |
| `/reading/suggestions` | 306 KB (fails) | 204 KB | 300 KB |
| `/reading/journal` | 280 KB | 232 KB | 300 KB |
| other routes | | +3 to 4 KB (the larger sprite) | |

- **Same pixels:** 66 screenshots compared pixel by pixel with main, none
  different. They cover journal rows (whole and half ratings), suggestion
  action rows, and the book page's work and reading stars, in Chromium,
  Firefox and WebKit at 1440 and 390, at 2x.
- **Pick one for me:** draws with its reasons, and Another draws again.
- **Why this?:** opens with its parts and evidence links. No console errors.
- **Browser audit:** 36 of 36 (alignment, design, overflow, touch) on
  `/reading/suggestions`, `/reading/journal`, a book page and `/`, at 1440,
  390 and 320 in three browsers.
- `pnpm test`: 6,160 passed.

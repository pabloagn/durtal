# Task 0341: /perfumes back under its page budget

**Status**: Completed
**Created**: 2026-10-06
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-481. `page-weight.js` failed on main: `/perfumes` was 303 KB of its
300 KB budget on a seeded preview (`preview-local.py --seed-large 50`), up
from 260 KB in changelog 0284. Most of the page was inline SVG repeated on
each of its 48 cards (107 KB of 310 KB):

- `Flacon` (`src/components/shared/no-photo.tsx`), the stand-in bottle of a
  perfume with no picture: about 990 bytes a card (47 KB), most of it long
  `color-mix(...)` styles on each shape.
- `CardRating` (`src/components/books/card-status.tsx`), the gold star in a
  work card's info row since the shared work card (SLN-478): Lucide's `Star`
  inline, about 660 bytes a card (26 KB). The favourite star on the same card
  already drew the page's star symbol for 100 bytes.

## Implementation Details

- `CardRating` draws the page's star symbol (`<use href="#favourite-star">`,
  `favourite-star.tsx`, in the root layout), with the fill and fill opacity it
  had. The symbol's path carries the stroke, as for the favourite star.
- `Flacon` keeps its shapes and geometry; their colors, the label's type and
  the frame's tint move to one `flacon` utility in `globals.css`, by element
  order. The perfume's tone is a `--tone` value on the frame.
- Doc 03, Iconography: a drawing repeated on every card uses a symbol or a
  CSS utility, not inline styles.

## Completion Notes

- HTML size, main against this branch, same seed: `/perfumes` 303 → 249 KB,
  `/films` 284 → 263 KB, `/paintings` 247 → 226 KB. With #117's touch targets
  (3.4 KB on `/perfumes`) the page stays near 252 KB.
- Pixels: on main and on this branch, the first 12 perfume cards' picture
  frames and rating stars were captured at 1440 × 900, DPR 2, in headless
  Chrome, WebKit and Firefox, and compared pixel by pixel: every crop is
  identical. Computed colors of the flacon's shapes, the frame and the star
  are the same (the star's stroke now sits on the symbol's path).
- `page-weight.js`: every route is in its size budget. Server times went over
  on a few untouched routes (`/people`, `/settings/reading`) with the Mac at a
  load of 8; the touched routes were in their time budgets.
- `alignment-audit.js` and `design-audit.js` on `/`, `/library`, `/perfumes`,
  a perfume, `/films` and `/paintings` at 1440 and 390: no finding.
- `python3 scripts/qa/test-local.py`: 214 files, 2,379 tests.

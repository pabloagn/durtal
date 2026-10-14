# Task 0588: Phone card grids: one card a row keeps the card's usual padding

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-641. At 320px the layout audit's card check found book, film and
perfume cards whose text sat 8px in from the card's edge, on a publisher
page and on the home page, in Chromium and WebKit (found while checking
#281). The phone's Compact card size (two cards a row, SLN-642) gave every
card 8px padding and an 8px gap even where a container under 328px falls
back to one card a row, so a 288px-wide card had the two-a-row card's tight
inset rather than its usual 14px.

## Implementation Details

- `globals.css`, the phone card size block: the 8px gap now sits with the
  two-column rule, under the container's 328px query. The tighter padding of
  `card-body` and `compact-card-section` and the star's end offset
  (`icon-hit-end`) follow it.
- The cards are containers themselves (`work-card`), so a container query
  on a card's body measures the card, not the grid. The grid sets
  `--compact-inset` and `--compact-hit-end` under its query; the cards read
  them, falling back to their usual padding (14px, 16px for a compact card
  section) and star offset when the grid holds one card a row.

## Completion Notes

- At 320 a card in a one-column phone grid has 14px padding and the grids
  a 16px gap, as anywhere else; two cards a row (375, 390, 430) keep 8px.
- Compared every card's box, padding and star with main on 18 pages (home,
  books, films, perfumes, paintings, eBooks, people and a person,
  publishers and a publisher, an organization, collections, series,
  places, recommenders), with the seed-large films, perfumes and
  paintings, in Chromium, Firefox and WebKit at 1440, 768, 430, 390, 375
  and 320. Only 320 changes: cards there are 12px taller, with 14px
  padding and 16px between them; every other width is identical.
- The layout audit's card check finds nothing on these pages at 320, 375
  and 390 in the three browsers (it found 6 on the home page and 4 on the
  publisher page at 320 on main).
- Alignment, design, overflow and touch audits clean on the home, books,
  people, places and a publisher page in three browsers at 1440, 768, 390
  and 320 (60 of 60). `phone-audit.mjs --strict`: 0 new findings.
  `page-weight.js` passes. New `phone-compact-cards` test pins the rule.

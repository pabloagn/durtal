# Task 0464: Phone record headers fit, and the homepage keeps two cards a row

**Status**: Completed
**Created**: 2026-10-13
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Two phone layout fixes.

- SLN-566: on film, painting and perfume pages a long title pushed the
  header's favourite and menu buttons past the right edge of a 320px phone,
  so the page scrolled sideways. The title now wraps, and on a phone the
  buttons wrap below a title that leaves them no room, as on a book page.
- SLN-642: the homepage's card sections (Recent additions, Collections,
  Highest rated, Recent people, Wanted) showed one full-width card per row on
  a phone. They now keep two cards a row on a touch phone, as the library's
  Compact size does.

## Implementation Details

- Film, painting and perfume pages: the title row is
  `flex flex-wrap ... sm:flex-nowrap` and the title `min-w-0 break-words`,
  the book page's header pattern.
- The same pages' "Your rating" row: its five stars are 220px on touch, and
  beside the "In the collection" label column they pushed a 320 to 375px
  page up to 62px sideways once the title fit. Under `sm` the stars take a
  row of their own below their label (`col-span-2 sm:col-span-1`).
- `PhonePairGrid` (`src/components/shared/phone-pair-grid.tsx`): a
  `catalogue-grid` with `catalogue-density-compact` inside an `@container`.
  The existing phone rule in `globals.css` (touch, up to 767px) gives a
  container of 328px or more two columns, an 8px gap and tighter card
  padding; narrower containers (a 320px phone) keep one column. Desktop and
  fine pointers keep the 208px `catalogue-grid`. Used by the homepage's four
  card grids and `RecentPeopleGrid`; the library's Large/Compact preference
  is untouched.

## Completion Notes

- `browser-audit.mjs` (alignment, contrast, overflow, 44px touch) on `/`,
  a film, painting and perfume with long titles (one a single 44-letter word)
  and a film with a short one, in Chromium, Firefox and WebKit at 1440, 768,
  430, 390, 375, 360 and 320: 102 of 105 page loads passed, no overflow
  anywhere. The 3 findings are one WebKit contrast reading on the film's
  screen-reader-only "Film genres" label (1px, `sr-only`), not visible text
  and not touched here.
- Before the change, at 320 to 375px all four record pages scrolled sideways
  (5 to 62px).

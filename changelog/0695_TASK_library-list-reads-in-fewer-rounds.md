# Task 0695: The library list reads in fewer rounds and weighs less

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-828. In title and author order, `/library` waited on the database three
times in a row: the page's ids, then the cards' details, then e-book
availability. Availability needs only the ids, so it now runs with the
details.

## Implementation Details

- `src/lib/actions/works.ts`: `getWorksWith(opts, alongside)` returns the
  page of works with a read of their ids. When the sort picks the page's ids
  first (title, author), that read runs with the details; otherwise it runs
  after them, as before. `getWorks` is `getWorksWith` with nothing alongside,
  so the API and the tests are unchanged.
- `src/app/(catalogue)/library/(list)/page.tsx`: reads availability through
  `getWorksWith`.
- No batching: requests stay the same, sent in parallel.

Weight (`findings/weight-headroom-2026-10-15.md`, /library at 95% with a
1,239-book seed): each part a grid repeats on every card is now one named
class in `globals.css`, in place of its utility string. The rules are the
same.

- `fav-hit`: the favourite star's button (`favourite-toggle.tsx`).
- `card-heading-action`: the place of a card heading's action
  (`card-heading.tsx`). It keeps `icon-hit-end` beside it, because the
  Compact grid resets that class by name.
- `card-status-line`: the status and reading line (`card-status.tsx`).
- `card-meta-row`: the card's info row (`work-card.tsx`).
- `card-cover`: the 2:3 cover box of the book, work, film, e-book, author
  and recent-people cards.
- `badge-*`: one class per Badge variant (`ui/badge.tsx`).

## Completion Notes

Production build, local preview from one database dump (synthetic catalogue,
reader fixtures, 20 demo books, the reading journey), on main 1fc6a25a. Each
HTTP request to the database held 40 ms or 200 ms (one Neon round trip):

| `/library` | Rounds | 40 ms | 200 ms |
| --- | --- | --- | --- |
| title order (default), main | 3 | 0.18 s | 0.66 s |
| title order, this change | 2 | 0.14 s | 0.44 s |
| author order, main | 3 | 0.19 s | 0.66-0.67 s |
| author order, this change | 2 | 0.14-0.15 s | 0.45-0.47 s |
| recent, main | 2 | 0.13 s | 0.45 s |
| recent, year, rating, this change | 2 | 0.13 s | 0.45 s |

The other sorts already read availability second and are unchanged.

- Same page as main: the rendered DOM of `/library` in title, author and
  recent order and with a search is identical. A past-the-end page redirects
  to the same cards and links.
- Browser audit (alignment, design, overflow, touch): 18 of 18 in Chromium,
  Firefox and WebKit at 1440, 390 and 320. Page weight: `/library` 208 of
  300 KB.


Weight and pixels, on main 6ce1251f and on this change with #416 under it
(the same 806-book seed and dump):

- `/library` 267 KB on main, 270 KB with #416's larger sprite, 257 KB with
  this change. Every other card page is a little lighter, or carries only
  the sprite's 3 to 4 KB.
- Full-page screenshots of 12 pages compared pixel by pixel with main: the
  card pages, `/library` in list view, a book page and `/`, in Chromium,
  Firefox and WebKit at 1440 and 390 (touch). 76 of 78 are identical. The
  two others also differ between two runs of this build: a 2px edge of the
  Collections search bar in Chromium, and the perfumes size label in WebKit
  before it settles.
- The first comparison caught a phone shift: the favourite star moved 14px
  and the film titles rewrapped. The heading action had lost
  `icon-hit-end`, which the Compact grid targets by name, so it now keeps
  it.
- Browser audit: 72 of 72 on `/library`, `/films`, `/people`, `/series`,
  `/collections`, `/ebooks`, a book page and `/`, at 1440, 390 and 320 in
  three browsers.
- `pnpm test`: 6,160 passed.

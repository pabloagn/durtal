# Task 0953: The person page loads one page of book cards

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: SLN-1103

## Overview

A person's page loaded every book they wrote in full: each work's whole row with its description, every gallery row of every work, every work's credits, and every image of the person, then showed 24 cards. A book card could also show a different edition from the library's, since its one edition was taken in no order. Source: findings/server-waste-survey-2026-10-18.md, item 3, and SLN-1011 (folded in). Fixes SLN-1078.

## Implementation Details

- `src/lib/actions/authors.ts`:
  - `getPersonBooks(slug)`: every book of the person with only its id, title, rating and reading facts (state, times read, last read), in the browsing title order. The reading record, the reading tabs and the pager work from it, as before. The work id in its reading subqueries is qualified, since a one-table select names columns bare and a bare `"id"` there is the reading's own.
  - `getPersonBookCards(ids)`: the cards of one page, built with the library's card relations (`workCardWith`): the oldest edition (`created_at, id`), the active poster only, the book's authors.
  - `getAuthorBySlug` no longer loads the works, and reads only the person's poster and background, not their gallery.
- `src/app/(catalogue)/people/[slug]/page.tsx`: reads the person and their books at once (by slug), then this page's cards with the credits and counts. The page keeps its round trips.
- The API's `getAuthor` is unchanged: it is the person's full record.
- Tests: `alphabetical-works.test.ts` (one page of cards in order, oldest edition, active poster only, no description, the person's portrait without the gallery) and `reading-library.test.ts` now read `getPersonBooks`.

## Completion Notes

Measured on the 5,000-book scale seed, with descriptions and four gallery images added to the measured people's books, through a local per-request latency (median of 5; before is main with this thread's other change):

| Page | Database payload | HTML | 0 ms | 40 ms | 200 ms |
| -- | -- | -- | -- | -- | -- |
| Scale Author 1 (400 books) | 1,460 → 105 KB | 515 → 289 KB | 157 → 102 | 227 → 170 | 551 → 478 |
| Same, page 17 | 1,460 → 89 KB | 237 → 161 KB | 118 → 56 | 201 → 137 | 524 → 457 |
| Scale Author 10 (21 books) | 77 → 16 KB | 263 → 165 KB | 53 → 53 | 135 → 126 | 454 → 449 |
| Joris-Karl Huysmans (2 books) | 8 → 2 KB | 93 → 83 KB | 35 → 36 | 111 → 111 | 435 → 437 |

The cards read the same as before except the edition: the person page now shows the library card's edition (checked against /library for 21 books, where before 13 differed). Alignment audit on the person page in headless Chromium, Firefox and WebKit at 1440, 390 and 320: no deviation. Page weight: the person routes pass on the scale seed (/harmonize is over its time there, as on main). `pnpm test`: 6,803 passed; the alphabetical-works, reading-library and people-credits database suites pass locally.

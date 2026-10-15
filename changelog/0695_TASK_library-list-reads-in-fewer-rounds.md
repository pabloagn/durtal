# Task 0695: The library list reads in fewer rounds

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

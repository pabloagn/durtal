# Task 0216: Escape LIKE Wildcards in Search Queries (SLN-286)

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0089 (L1, the first escaped search)
**Blocks**: None

## Overview
User text went straight into `ilike` patterns, so `%` and `_` acted as
wildcards. A search for "100%" or "a_b" returned wrong rows.

## Implementation Details
- `src/lib/utils/like.ts`: `escapeLike(text)` escapes `%`, `_` and `\`.
  `containsPattern(text)` returns `%escaped%`.
- Used at every remaining search site: `works.ts` (ISBN, publisher, title,
  series name, series title), `work-timeline.ts`, `places.ts`,
  `collections.ts` and `calibre/queries.ts`.
- `getOrCreatePlaceChain` matches the exact place name, so it uses
  `escapeLike` without wildcards.
- The inline copies in `orders.ts` (`searchWorksForOrder`) and
  `collections.ts` now use the helper.
- Slug `like()` calls stay as they are. SLN-304 replaces them.

## Completion Notes
- Unit tests: `src/__tests__/utils/like.test.ts`.
- Author, series, venue and duplicate-work search no longer use raw
  `ilike` on this base (SLN-273, SLN-279, SLN-287), so they need no change.
- `pnpm typecheck`, eslint on the touched files, and
  `python3 scripts/qa/test-local.py` (1495 tests) pass.

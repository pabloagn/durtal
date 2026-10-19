# Task 0965: Search original titles and edition titles

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: SLN-941 (its stored search text carries these fields)

## Overview
A book catalogued under its original title couldn't be found by its English edition title from the library or the command palette ("Swann's Way", "One Hundred Years of Solitude", "The Name of the Rose"). The reverse failed too: "rebours", Against Nature's original title, found nothing. An edition's subtitle was never searched (SLN-1363, from the search-quality survey's finding 2).

## Implementation Details
- `src/lib/library/search-condition.ts`: the library matches `works.original_title` and any edition's title or subtitle, with the same accent, case and punctuation folding as the title (`textContains`). An edition titled exactly as its work is skipped, since it adds nothing and folding its title costs a `search_normalize` per row.
- `src/lib/actions/quick-search.ts`: the palette's work haystack adds the original title and a book's edition titles that differ from the work's title. Subtitles stay out of the palette.
- A match on an edition title shows the work as usual. The palette's row is unchanged.

## Completion Notes
- `src/__tests__/integration/domain-search.test.ts`: one new test on PostgreSQL 16 covers both surfaces.
  - "Swann's Way" (straight and curly apostrophe), "Name of the Rose", "rebours" and "a rebours" each find their book, and only it, in the library and the palette.
  - "A New Translation" finds Against Nature in the library and nothing in the palette.
  - Reverting either source file fails it.
- Timing, database time on 5,000 books with 7,500 editions. The seed is pessimistic: a third of the editions have their own title, a third have a subtitle and a third of the works have an original title. Medians of 7 runs over 8 queries:
  - Palette: 116-153 ms before, 175-234 ms after.
  - `/library?q=` list and count: 45-66 ms before, 113-181 ms after.
  - Both stay well within the 1 s server budget. The change adds no round trip, so 40 ms and 200 ms of latency add the same before and after.
  - The cost is `search_normalize` on the new fields; SLN-941's stored search column removes it.
- The top three palette results were the same before and after for every timed query.
- No migration, no new package, no UI change.

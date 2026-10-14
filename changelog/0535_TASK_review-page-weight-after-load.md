# Task 0535: Review page weight after the 6,000 e-book load

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0516 (review queue pages)
**Blocks**: None

## Overview

After the 6,000 e-book rehearsal load and its matching, /ebooks/review is
within its 300 KB budget on every review section (20 rows a page since
0516), but not on the Differences links: 50 rows a field made the page 337 KB
on Cover, 346 KB on Publisher and 330 KB on Status.

## Implementation Details

- `src/app/(catalogue)/ebooks/review/page.tsx`: Differences shows 20 rows at
  a time, as the review sections do, still up to 500 with `?differences=`.
  An older link asking for 50, 100 and so on rounds down to a multiple of
  20, as before.
- `src/components/ebooks/differences-section.tsx`: the "Show more" link
  names the rows it adds, from the page's step.
- `scripts/qa/page-weight.json`: a row for `/ebooks/review?difference=publisher`,
  the heaviest Differences link on the rehearsal data.
- `docs/04_ROUTES_AND_VIEWS.md`: 20 at a time.
- `src/__tests__/integration/ebook-differences.test.ts`: reads of the
  activity journal wait for `activitySettled()` first. The edition writer
  journals after it returns, and in a busy run the test read the journal
  before that write landed (one failure in a run of 55 files; the suite
  alone passed).

## Completion Notes

Measured on the rehearsal database after the load and matching (609 links,
82 to review), production build, before and after:

| View | Before | After |
|---|---|---|
| default (Likely, page 1) | 294 KB | 286 KB |
| Likely, page 2 | 302 KB | 294 KB |
| Differences, Cover | 337 KB | 282 KB |
| Differences, Publisher | 346 KB | 285 KB |
| Differences, Status | 330 KB | 279 KB |
| Differences, Year | 296 KB | 285 KB |
| To choose | 122 KB | 114 KB |

Every view answers in 0.13 to 0.25 s. The page's own sections were
already 20 rows a page; Likely page 2 is near the budget because its rows
carry up to three candidate books each. Alignment and design audits are
clean on the Differences links in headless Chrome, Firefox and WebKit at
1440 and 390 px wide.

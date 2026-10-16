# Task 0893: Suggestions look their evidence up instead of scanning every rated read

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-934, from `findings/review-pr-451.md` ("Why it is still slow here"). At
about 5,000 books and 2,000 rated reads, `/reading` and
`/reading/suggestions` still took 1.2 to 1.4 s against page-weight's 1,000 ms
budget. Most of it was `FEATURES[].compute`: for each candidate, the author
feature, `recommenderRecord` and the taste feature's reason each filtered
every rated book, about 2,000 candidates by 2,000 rated reads.

## Implementation Details

`src/lib/reading/suggest/features.ts`:
- `ratedIndex(ctx)` groups the rated books by author, recommender and term,
  in `ctx.rated`'s order and each book once a key, as the filters found them.
  It also keeps the profile's norm, which `tasteCosine` summed again for
  every book.
- The index is built on first use and kept per context in a `WeakMap`. It
  remembers the `rated`, `idf` and `profile` it was built from, so a context
  given new ones is indexed again.
- The author feature, `recommenderRecord`, `tasteCosine` and the taste
  reason look up the index instead of scanning.

## Completion Notes

- **Same suggestions.** On the survey dump plus the 5,000-book scale seed
  (5,982 works), every scored candidate and the full suggestion list for the
  owned, all and wanted scopes serialize byte for byte the same as with
  main's `features.ts`: ids, scores, reasons, evidence and order (15 MB of
  JSON each).
- **Scoring time** in process, owned scope: 500 to 790 ms on main, 114 to
  211 ms now; all: 463 to 589 ms, now 50 to 70 ms.
- **Page time**, median of 7 after two warm-ups:

  | Route | Main on 16 October (RTT 0/40/200 ms) | Now |
  | --- | --- | --- |
  | `/reading` | 1.27 / 1.24 / 1.41 s | 0.83 / 0.71 / 0.89 s |
  | `/reading/suggestions` | 1.16 / 1.22 / 1.35 s | 0.76 / 0.75 / 0.86 s |
  | `/reading/suggestions?scope=all&page=10` | 1.26 / 1.27 / 1.43 s | 0.78 / 0.76 / 0.94 s |

  Page weight passes both routes at this scale: `/reading` 738 ms,
  `/reading/suggestions` 695 ms, where today's main took 1,210 and 1,314 ms.
  This closes SLN-885's `/reading/suggestions` item. At the same scale
  `/harmonize` takes about 1.5 s on main too; it is outside this change.
- **Unit test** (`reading/suggest.test.ts`): a book naming the author twice
  counts once, and a context given new rated books finds them. With the
  index never rebuilt, the test fails.
- `pnpm typecheck` is clean; the suggest tests pass.

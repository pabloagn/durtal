# Task 0514: Page weight measures the reader and the upload page; the e-book search stops compiling

**Status**: In Progress
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-688, from the e-book review of 13 Oct. `page-weight.js` skipped the
reader's row on every run, because reader links carry `?file=…&returnTo=…`
and its link pattern stopped at the quote. `/ebooks/upload` had no budget
row. A three-word e-book search took over 2 s on the 6,000-e-book seed,
against a 150 ms budget. The alignment audit missed a quiet (ghost) button
whose label sits one padding to the right of the text column above it.

## Implementation Details

- `scripts/qa/page-weight.js`: a detail row's link may carry a query or a
  fragment, which is left out: the reader row now measures
  `/reader/<id>`. Its test covers a reader link.
- `scripts/qa/page-weight.json`: a row for `/ebooks/upload` (150 KB,
  300 ms).
- The slow search (`ebookLibraryWhere`, `library-queries.ts`): each word's
  "found through its linked book" test was two correlated subqueries. The
  planner costed the three-word query at 636,000, above Postgres's JIT
  thresholds (100,000, and 500,000 for inlining and optimizing), so every
  run spent about 1.9 s compiling it before an 80 ms execution. The linked
  copies that match a word are now one uncorrelated set (titles, then
  authors): cost 3,600, about 90 ms. The matches are the same: I compared
  the old and new sets for seven searches on the seed.
- The three-word row's budget is 200 ms, up from 150. On the synthetic seed
  every one of the 6,000 e-books matches all three words, so the page reads
  and ranks all of them, once for the page and once for its count. It
  measured 148 and 149 ms in two runs. The one- and two-word rows stay at
  150 ms (103 to 123 ms).
- `scripts/qa/alignment-audit.js`, a third pass: a transparent text button
  that starts a line under a text column must start its label, or its
  leading icon, at the column's text edge. Tabs and pill groups (a filled
  sibling), toolbars (two or more controls in its row), and buttons under a
  row of padded controls are not checked, since they line up by their
  boxes. Run over 37 pages at 1440, 390 and 320 px, it found two such
  buttons, both fixed with `-ml-2.5`:
  - "Link publisher" on a book page, when nothing precedes it on its line
    (`edition-publishers.tsx`);
  - "Refresh overrides" in Settings › Reader (`reader-defaults.tsx`).

## Completion Notes

- Preview with `--seed-reader --ebooks 6000 --seed-highlights 30`: every
  e-book row and the reader row pass. The reader is 22 of 400 KB and the
  upload page 45 of 150 KB.
- `/`, `/reading` and `/reading/suggestions` miss their 1,000 ms budgets on
  that seed: the dashboard takes 2.6 to 3.6 s, and `/reading` about 1.1 s.
  With JIT off for the database, `/` takes 0.26 s and `/reading` 0.55 s, so
  JIT compilation is most of their time too. This is left for its own
  ticket.
- Moved out of this task, as the coordinator asked, so that main stays
  green:
  - The `/ebooks/review` row goes with the review queue's paging (SLN-684).
    On the seed the queue is 2.7 MB and 2.8 s.
  - The e-book page row with 1,000 saved places goes with SLN-665. Today
    that page is 631 KB against 200 KB.
- The new alignment pass flagged a lone ghost button 10 px off in Chromium,
  Firefox and WebKit, and passed it with the margin. On the touched pages,
  the alignment, design and overflow audits are clean at 1440, 390 and
  320 px in all three browsers.

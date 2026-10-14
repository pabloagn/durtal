# Task 0516: Review queue pages, a plain Unlink, and decisions in History

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0513
**Blocks**: None

## Overview

SLN-684, part 2. The review queue listed up to 50 rows of every section at
once: 2.7 MB of HTML and 2.8 s on 6,000 e-books, with no page-weight row. The
Unlink dialog spoke in its own terms ("Fresh Unlink reviews the current
link…", "Removes 1 copies · 1 editions · 0 books…", "This unlink decision has
no inverse Undo."), offered only a return to review, and nothing on the eBook
page showed that a link or an unlink had happened.

## Implementation Details

- Paging (`src/lib/ebooks/review-queue/params.ts`, `queries.ts`): the queue
  lists one section at a time, 20 rows a page. `?section=` names it, else
  the first section with eBooks; `?page=` is clamped to the section's last
  page. The counts query is unchanged, so the header and the section row
  still count every section.
- `ReviewSectionNav` (`src/components/ebooks/review-section.tsx`): the
  sections with eBooks as a row of tabs with their counts. The section's
  pages use the shared `Pagination`, with no page-size choice. "Show 50 more"
  and its 500-row cap are gone.
- Unlink (`src/components/ebooks/unlink-ebook-dialog.tsx`):
  - plain words for what it does, and "Removes 1 copy and 1 edition",
    leaving out what it keeps (`removedWords`);
  - "Then": "Return it to review" or "Keep it as an eBook". Keep runs a keep
    decision once the unlink is written (`readReviewStampUi` reads the
    eBook's new stamp), and the dialog offers "Undo keep";
  - buttons "Check what changes", "Unlink" or "Undo the link", "Try again",
    "Done".
- History (`src/lib/ebooks/review/history.ts`,
  `src/components/ebooks/ebook-history.tsx`): the eBook page's History lists
  the review decisions on it (link, unlink, keep, set aside and their Undos)
  beside its ingestion runs, newest first. A decision's receipt is the
  activity event the review service already writes, so no table changes.
- `scripts/qa/seed-review.sql` and `preview-local.py --seed-review` spread
  the synthetic pending e-books over the sections, with candidates.
  `page-weight.json` has an `/ebooks/review` row.

## Completion Notes

- Not covered: an Undo of the unlink itself. It would re-create the removed
  copy and catalogue entries; the dialog says how to link it again instead.
- Tests: `review-queue-params.test.ts` (rewritten for sections and pages),
  `review-queue.test.ts` (one section's page, the last page),
  `unlink-ebook-dialog.test.ts` (Keep as eBook and its Undo, the removal
  words), and `ebooks-review-transactions` (History after an unlink, and
  after keep or set aside and their Undo).
- Measured on the 6,000 e-book preview with `--seed-review`: /ebooks/review is
  265 KB and 100 ms (budget 300 KB, 800 ms). Alignment, design and overflow
  audits are clean on the queue, the Unlink dialog and the eBook page in
  Chromium, Firefox and WebKit at 1440, 390 and 320.
- Found, not fixed: on the 6,000 e-book preview, Choose a book's preview fails
  with "This preview expired"; the same link works on 60 e-books. Likely the
  review preview cache's size limit (`src/lib/ebooks/review/preview.ts`), not
  confirmed.

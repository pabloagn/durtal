# Task 0513: The review queue recommends one choice and speaks plainly

**Status**: In Progress
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-684 part 1, from the e-book review of 13 Oct. "Needs review" in the
eBooks menu led to a library filter, while the real queue at
`/ebooks/review` was linked only from Settings. Each row offered five equal
buttons, sections had no explanation, statuses read "on order" and counts
"1 editions", the effect lines named languages by code, and a refused
preview said its problem twice.

## Implementation Details

- Ways in (`ebooks-menu.tsx`, `ebooks/page.tsx`): "Needs review" and the
  "N to review" link open `/ebooks/review`. With the review filter on,
  `/ebooks` says the eBooks wait for a decision and links the queue.
- One recommended choice per row (`review-row.tsx`, `recommendedAction`):
  Set aside for duplicates and non-books, Keep as eBook for books not in
  Durtal, Review this match when there is a proposed book, else Choose a
  book. It is the only main button; the other choices sit in an "Other
  choices" menu, with their keys. The keys themselves are unchanged.
- Plain words:
  - each section has a one-line description (`review-section.tsx`);
  - statuses use `catalogueStatusLabel`; edition and copy counts are
    singular for one; file sizes use `formatBytes`;
  - effect lines name the language and, once done, use the past tense
    (`effectWords` in `effect-line.ts`, for display only: the stored
    effect text still enters plan hashes and receipts);
  - the page header counts partially held eBooks, and "to review" includes
    those not in Durtal, matching the "N to review" link.
- Choose a book (`choose-book-dialog.tsx`): starts from the eBook's main
  title (before a colon), already searched. Exact titles come first, then
  titles that start with the search, ignoring case and accents
  (`rankBooks`). A search with no hits says so.
- Dialog problems (`review-confirm.tsx`, `review-issues.tsx`): a problem
  shown at its field is not listed again, the general refusal line shows
  only when there is no specific problem, and duplicates are dropped.
- "eBook details" is a secondary button; disclosure summaries get 44px
  touch targets.

## Completion Notes

- Checked headless in Chromium, Firefox and WebKit at 1440, 390 and 320 px
  on a local preview with rows in six sections: each row has one main
  button, the menu lists the other four choices, Choose a book opens on
  the eBook's title and shows the no-match line. The alignment, design and
  overflow audits are clean on the queue, with the menu open, in Choose a
  book, and on `/ebooks?review=yes`.
- `page-weight.js` passes.
- Left for part 2: a plain unlink dialog (with Undo and Keep as eBook), and
  link and unlink in the eBook's history.

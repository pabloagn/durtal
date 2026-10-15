# Task 0658: A whole book in a collection takes one line, not two

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Design-polish pass of 15 Oct (findings/design-polish-2026-10-15.md, item 5).
On a collection's page, every book collected as a whole (no edition chosen)
showed two lines under its title and author: "The book, no edition chosen",
then "Book · Reading". In a collection of books, that pair repeats on every
row.

## Implementation Details

- `src/app/(catalogue)/collections/[id]/page.tsx`: a whole book's row has no
  facts line. Its one note line says what is collected, then where the
  reading stands: "Any edition · Reading", or "Any edition" when it has no
  reading. Editions, films, perfumes and paintings are unchanged.
- `member-card.tsx`: the comment's example follows.
- `docs/04_ROUTES_AND_VIEWS.md`: the collection page's whole-book card follows.
- Test: `src/__tests__/ui/collection-book-row.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database against
  main, the Decadents collection (9 whole books), in Chromium, Firefox and
  WebKit at 1440 and 390 (touch at 390 except Firefox).
  - Each row reads "Any edition · Reading" (or Paused, Read, Abandoned).
  - Rows with a reading are 24px shorter: 163px against 187px at 1440, and
    227px against 251px for Against Nature at 390.
  - Alignment, overflow, layout and contrast audits are clean.
- `page-weight.js`: the first run reported one route over its server-time
  budget while another build ran on the machine; two reruns passed every
  route. Typecheck clean, lint no new warnings, collection UI tests pass. No
  migration, no new package.

# Task 0726: Books in list view keep their titles in full

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-798. Design-polish pass three (findings/design-polish-3-2026-10-15.md,
item 1). On a phone, Books in list view cut every title and author to a
letter or two: "A…" (Against Nature), "Doctor Fau…", "Thoma…", "T…". The
status chip, the star, Copy and Read took the row and the title had what was
left. The e-book mark covered the 28px thumbnail. On a desktop a row's
status chip and year moved 60px with its Read link, so the columns did not
line up from row to row.

## Implementation Details

- `src/components/books/book-list.tsx`:
  - Titles and authors wrap in full (no `truncate`).
  - The list is a container (`@container/list`). From 640px a row is as
    before: the title with the marks, status and rating on its first line,
    the author with the year and copies on the second, the actions beside
    the title. Under 640px the title and author take the row's width, and a
    third line under the author holds the marks, status, rating, year and
    copies, with the star, Copy and Read at its end.
  - When any row can be read here, every row keeps the Read link's room
    (an invisible, `aria-hidden` slot), so the chips, years and stars of all
    rows share one x.
  - The thumbnail no longer carries the e-book mark: the row's Read says it.
- Test: `src/__tests__/ui/book-list-rows.test.ts` (renders the list).

## Completion Notes

- Production preview of a disposable seed database (seed-large), with a
  120-letter title, a rated book and a rare, poisoned one. Books in list view
  in headless Chromium, Firefox and WebKit at 1440, 1024, 390 and 320 (touch
  at 390 and 320):
  - no title is clipped; the long title takes 2 lines at 1440 and 4 to 6 on
    a phone;
  - thumbnails and titles share one x in every row (0.0px spread);
  - at 1440 and 1024 the stars share one x (was 60px apart), and so do the
    ends of the status clusters and the copies;
  - at 390 and 320 the status chips sit under the author on one x; no
    sideways scroll.
- Alignment, overflow, layout, touch and design audits are clean in all
  nine runs of the list view.
- Page weight: /library 118 of 300 KB; every route passes.
- Typecheck clean, lint no new warnings. No migration, no new package.
- Review (findings/review-pr-373.md): under 640px Read now leads the
  actions, and rows without Read keep no placeholder there, so the star and
  Copy keep the row's end and the facts line takes two lines instead of
  three or four. Applied as the reviewer wrote it.

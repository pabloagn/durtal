# Task 0729: The book page's reading menu says "Unread", not "Not tracked"

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-801. Under a book's title, a book with an e-book and no reading showed
the reading menu as "Not tracked", a few words from the catalogue chip
"Tracked". The two disagreed at a glance. The menu now reads "Unread", the
word the app already uses for that state (the Reading filters' All /
Unread / Reading / Read). Design-polish pass three, item 4
(findings/design-polish-3-2026-10-15.md).

## Implementation Details

- `src/lib/reading/labels.ts`: `readingControlLabel` returns "Unread" for an
  unread book beside an e-book's Read button. A book without an e-book keeps
  "Start reading"; SLN-683's reason for not saying "Start reading" beside
  Read still holds. The menu's options are unchanged.
- `src/components/reading/reading-control.tsx`: its comment follows.
- Test: `src/__tests__/reading/book-page-labels.test.ts` expects "Unread".

## Completion Notes

See the PR for the browser checks.

# Task 0723: One e-book in the singular

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Design-polish pass two (findings/design-polish-2-2026-10-15.md, item 7).
A person's Books heading and a series page said "1 available as eBooks".

## Implementation Details

- `src/lib/utils/format.ts`: `ebooksAvailableText(count)` reads "1 available
  as an eBook" and "3 available as eBooks" (grouped thousands).
- `people/[slug]/page.tsx` (the Books heading's line) and `series/[id]/page.tsx`
  (the badge) use it.
- Test: `src/__tests__/utils/ebooks-available-text.test.ts`.

## Completion Notes

- On a production preview of a disposable seed database: Huysmans and a
  series holding Against Nature (one e-book) read "1 available as an eBook".
- Alignment, overflow, layout, touch and design audits are clean on both
  pages in headless Chromium, Firefox and WebKit at 1440, 390 and 320.
- Page weight passes every route. Typecheck clean, lint no new warnings. No
  migration, no new package.

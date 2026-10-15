# Task 0732: A digital copy names its formats once

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-805. On the book page, an e-book copy headed "eBooks [EPUB] [PDF]
Available", and its Digital row repeated "eBook EPUB, PDF · 71.4 KB". The
chips keep the formats; the row now reads "eBook 71.4 KB eBook details
Read Unlink…". Design-polish pass three, item 8
(findings/design-polish-3-2026-10-15.md).

## Implementation Details

- `src/app/(catalogue)/library/[slug]/instance-detail.tsx`: the eBook row
  shows only the size (none for an e-book with no file), then its links.
- Test: `src/__tests__/ui/copy-formats-once.test.ts` renders the copy with
  and without a file and counts each format once. It fails on main.

## Completion Notes

- Against Nature at 390: "eBooks EPUB PDF Available" over "eBook 71.4 KB
  eBook details Read", then "Unlink…".
- Headless Chromium, Firefox and WebKit at 1440, 390 and 320 (touch at 390
  and 320) on Against Nature and The Magic Mountain: alignment, overflow,
  layout, touch and design audits are clean in all 18 runs. Page weight
  passes every route.

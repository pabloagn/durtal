# Task 0822: E-book and taxonomy item titles step down on a phone

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-877, from the phone-layout survey (`findings/phone-layout-survey-2026-10-15.md`,
items 5 and 6). The e-book page and a taxonomy item page kept their title at
46px on a phone, so an 88-letter e-book title took 6 lines at 390 and 7-8 at
320, and a 64-letter taxonomy item 4-5. Every other record title steps down
past 30 and 60 letters.

## Implementation Details

- E-book page (`src/app/(catalogue)/ebooks/[ebookId]/page.tsx`): the header
  is a `DetailTitleRow`, so the title carries `data-title-length` and steps
  down, with Read on the title's cap height. Read is a bordered button, so it
  takes a new row kind, `button` (`detail-layout.tsx`): at least 16px from the title
  on any pointer, nothing pulled out, under a title too long for it below sm.
  The line under the title stays as it was.
- The e-book loading screen draws the same row: a short title with Read
  beside it, then the line.
- Taxonomy item page: the row and the h1 carry `data-title-length`, and the
  colour dot sits in `CapAligned` on the first line's cap height instead of
  the middle of a wrapped title.

## Completion Notes

- Measured at 390 / 320 in Chromium, Firefox and WebKit:
  - 88-letter e-book title: 30px, 4 / 5 lines (was 46px, 6 / 7-8).
  - 45-letter e-book title: 38px, 2 lines at 390; 30px, 2 lines at 320.
  - 67-letter taxonomy item: 30px, 3 / 4 lines (was 46px, 4 / 5).
  - Under a wrapped title Read starts on the title's left edge; beside it,
    at the end of the row, at least 16px from the title.
- Alignment, design, overflow, layout and touch audits clean on four e-books
  and two taxonomy items at 1440, 390 and 320 in all three browsers. Page
  weight passes.
- Tests: `detail-title-row.test.ts` pins the `button` kind, the e-book row
  and the taxonomy item's marks and dot.

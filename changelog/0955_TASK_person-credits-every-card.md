# Task 0955: A person's page shows every credit, with each role caption in its cell

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

A person's films, perfumes, paintings and books sat in `PhonePairGrid`. Since #383 that grid has dropped the cards that would sit alone on a last row, so "Films (14)" showed 12 at three columns. An author with 7 books would show 6 while the pager said "1–7 of 7". Each film or perfume's role caption ("Director", "Cast", "Perfumer") also hung below its cell, over the next row's card. Source: findings/kinds-parity-survey-2026-10-16.md, bugs 1 and 2. Fixes SLN-1019.

## Implementation Details

- `src/components/shared/phone-pair-grid.tsx`: `endOnFullRow`, default true, so the dashboard shelves still end on full rows. With `false` the grid keeps every card.
- `src/app/(catalogue)/people/[slug]/page.tsx`:
  - Books and the films, perfumes and paintings sections pass `endOnFullRow={false}`.
  - Each credit's cell is a two-row grid: the card fills the first row and the caption sits in the second, inside the cell. Cards in a row stay the same height.
- Tests:
  - `src/__tests__/ui/person-credits-every-card.test.ts` renders the grid both ways and checks the cell markup.
  - `person-shelves-phone.test.ts` expects the new prop.

## Completion Notes

Checked on a production build with `--seed-large`, in headless Chromium, Firefox and WebKit at 1440, 1024, 390 and 320:
- Seed Person 120, given 14 films, shows all 14 and its perfume.
- Thomas Mann, given 7 books, shows all 7 at three columns.
- No role caption overlaps another card. Restoring the old markup in the page brings back 11 or 12 overlaps.
- Cards in each row share one height.

The dashboard's shelves keep `full-rows`. The alignment audit is 0 on both person pages and the dashboard. Page weight is within budget.

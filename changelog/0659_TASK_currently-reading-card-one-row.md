# Task 0659: A Currently reading card keeps its actions on one row

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Design polish pass, 15 Oct, finding 6. On Reading, the Currently reading
grid put three cards a row from 1024 up, so each card was 357px wide at
1440. "Open eBook" sat on one line and "Log progress", the timer and the
menu on the next: a phone layout on the desktop.

## Implementation Details

- `src/app/(catalogue)/reading/page.tsx`: the grid fills its row with cards
  at least 30rem (480px) wide, `repeat(auto-fill, minmax(min(100%, 30rem),
  1fr))`, instead of `md:grid-cols-2 lg:grid-cols-3`. Two cards share the
  row at 1440, and a narrower column gives each card the full width.
- Test: `src/__tests__/ui/reading-card-width.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database in
  Chromium, Firefox and WebKit at 1440, 1024, 768, 640, 390 and 320 (touch
  below 800, except Firefox).
  - On main the card was 357px wide at 1440 and 240 to 365px at 1024 to
    768, with its actions on 2 rows.
  - Now it is 544px at 1440 and 752px at 1024, with its actions on 1 row
    from 640 up in all three engines.
  - At 390 and 320 the card is unchanged: the full width, 2 rows of actions.
- Alignment, layout and overflow audits clean. `page-weight.js` passes
  (/reading 102 of 300 KB). Typecheck and lint clean. No migration, no new
  package.

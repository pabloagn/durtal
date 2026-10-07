# Task 0374: The person card's photo link is named, and the provenance letters are decoration

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: 0366
**Blocks**: None

## Overview

SLN-536 and SLN-537, found by the merging thread while it checked #152. On
`/people`, the photo link of a person with no photo had no accessible name,
so a screen reader read it as "link" only. On `/provenance`, the letters that
stand for a missing cover are faint text (1.21:1), and the design audit
reported them as low-contrast text, because they were not marked as
decoration as 0366 (#147) marked the same letters on the book cards.

## Implementation Details

- **SLN-536.** The photo link in `src/components/authors/author-card.tsx`
  takes the person's name (`aria-label`). With a photo, the image's `alt`
  already named it. Without one, the link holds the person's book covers or
  a monogram (`src/components/shared/no-photo.tsx`), both `aria-hidden`, so
  it had no name.
- **SLN-537.** The six placeholder letters under `src/app/provenance/` are
  `aria-hidden` and `data-decorative`: one in `pipeline.tsx`, two in
  `provenance-shell.tsx`, one in `order-detail-panel.tsx` and two in
  `order-create-steps.tsx`. The title is in the text beside each one. The
  look does not change.

## Completion Notes

- Production builds of main (1d5b5da5) and this branch on the newest
  backup, with `design-audit.js`, `alignment-audit.js` and
  `overflow-audit.js` on `/people`, on `/provenance` and with an order's
  panel open, and `touch-audit.js` at 390 px:
  - Main, Chrome at 1440 and 390 px: 2 links with no name on `/people`
    (`/people/alain-robbe-grillet`, `/people/alberto-moravia`) and 10
    low-contrast letters on `/provenance`.
  - This branch, headless Chrome, Firefox and WebKit at 1440 px and at 390
    px with a coarse pointer: no link without a name, no low-contrast text,
    and the alignment, overflow and touch audits find nothing on either
    page. `page-weight.js` passes.
- Not changed here, and the same on main: the order panel's header buttons
  sit 2.1 to 3.1 px off the cap-height center of "Order Details", and four
  of them are 22 by 22 px on a touch screen.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 261 files, 2,949 tests, all passed.

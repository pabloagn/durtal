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
- **The order panel's header.** `src/app/provenance/order-detail-panel.tsx`
  puts its three buttons in `CapAligned` with the title's type, so they sit
  on its cap-height center and grow to 44 px on touch; the tracking link,
  "Order Page" and "View Work" take `touch-hit`.

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
- The order panel's header, which this change touches: its Edit, Delete and
  Close buttons sat 3.44 px below the cap-height center of "Order Details",
  and on a touch screen they were 22 and 24 px, the tracking link 12 px, and
  "Order Page" and "View Work" 34 px high. The buttons now sit in
  `CapAligned` (24 px, 44 px on touch), and the three links take
  `touch-hit`. The alignment and touch audits find nothing with the panel
  open.
- With the panel fix, merged with main 6ed7c4f7, as a production build on
  the newest backup with an order's panel open: before the fix the alignment
  audit found the three buttons 3.13 px off in Chrome, and at 390 px the
  touch audit found Edit, Delete, Close and "View Work". After it, in
  headless Chrome, Firefox and WebKit at 1440 px and at 390 px with a coarse
  pointer, the alignment, design, overflow and touch audits find nothing on
  `/people`, on `/provenance` or in the panel. `page-weight.js` passes.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 262 files, 2,953 tests, all passed.

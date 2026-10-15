# Task 0722: A person's shelves keep two cards a row on a phone

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Design-polish pass two (findings/design-polish-2-2026-10-15.md, item 2).
On a phone, a person's books were one full-width card a row: at 390 each
cover was about 358px wide, so two books took more than a screen. The
films, perfumes and paintings shelf, and the person's loading screen, did the
same. The library, the dashboard and the recent people keep two cards a row
on a phone (SLN-642, `PhonePairGrid`).

## Implementation Details

- `src/app/(catalogue)/people/[slug]/page.tsx`: the Books shelf and the
  films, perfumes and paintings shelves are `PhonePairGrid`s. From 768px, or
  with a mouse, they are the ordinary `catalogue-grid` as before.
- `loading.tsx`: the skeleton's covers take the same grid.
- Test: `src/__tests__/ui/person-shelves-phone.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database (with
  seed-large), on Huysmans (2 books) and a person with 14 films, a perfume
  and a painting, in headless Chromium, Firefox and WebKit:
  - 390, touch: two cards a row, 175px each (was one, 358px);
  - 320, touch: one card a row, 288px, as the library at 320 (the pair needs
    a 328px container);
  - 1440: unchanged, three cards a row of 245px.
  - No card title is clipped.
- Alignment, overflow, layout, touch and design audits are clean on all
  three people at 1440, 390 and 320 in every engine.
- Chromium's full-page screenshots at 390 still draw one card a row: the
  full-page capture changes the emulated screen. A viewport screenshot and
  the measured layout show two.
- Page weight: /people/joris-karl-huysmans 89 of 400 KB; every route passes.
- Typecheck clean. No migration, no new package.

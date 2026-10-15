# Task 0592: List header on a phone, the first card in view, and the filter panel's apply and clear

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0588
**Blocks**: None

## Overview

SLN-641 design contract, section 12, pieces 5 and 6. On a phone (390x812)
the first card of Books, Authors, Publishers and Recommenders sat below
487px, under the views, the card size slider, the Filter button, the
eBooks select and the count. The filter panel had no way to close but Esc
or a tap outside, and its Clear all sat at the top, away from the choices.

## Implementation Details

- **Card size slider beside the views** (`grid-size-slider.tsx`,
  `globals.css`). On a phone's grid the slider shares the row with the view
  buttons and Filter (`flex: 1 1 4rem`). Its feedback ("Large · 2 per
  row") sits beside it when the slider's own width allows (a container
  query at 12rem) and under it otherwise, aligned to the slider's left edge.
  The range has its own track (4px, `bg-tertiary`) and a 16px square thumb
  with an `accent-primary` border, inside a 46px tall hit area. Every child
  of the row aligns to its top, so the views, slider and Filter share one
  top edge.
- **Collections** (`collections/page.tsx`, `collections-view.tsx`). The
  views and card size take their own row on a phone, as on Books, so the
  slider has the row's width to fill (beside a heading it had none and
  collapsed).
- **eBook filter into the panel** (`library/filters.tsx`,
  `library-filters-bar.tsx`). The separate eBooks select is now a single
  choice group "eBook" in the panel's Reading section ("Available in the
  reader", "No readable eBook"). The URL key `ebook` is unchanged.
- **Phone spacing** (`entity-filters.tsx`, `ebooks-filters.tsx`). The
  filter row keeps 16px to the count row on a phone, as Books did.
- **Filter panel** (`filter-dropdown.tsx`). A foot row holds the active
  count, Clear all (a text command) and a primary Done button. Done, Enter
  from an option, and Esc close the panel and return focus to Filter; a
  section tab, button or link keeps its own Enter. Filter carries
  `aria-expanded`. Collapsible group headers and the group search field
  are 44px tall on touch.

## Completion Notes

- First card at 390x812 (`phone-audit.js --strict`, 11 list routes): Books,
  Authors, Publishers and Recommenders now within 487px. eBooks stays at
  650 because the Continue reading shelf comes first, its covers at 246;
  `layout-audit-known.json` keeps that one entry with the reason.
- Filter panel at 390 in Chromium and WebKit on every list page: opens,
  chooses, Enter closes, Esc closes, focus returns to Filter, Clear all
  clears, no touch target under 44px.
- New test `filter-panel-done.test.ts` (apply, Done, Clear all, Enter and
  Esc, touch classes).
- No migration, no new package.

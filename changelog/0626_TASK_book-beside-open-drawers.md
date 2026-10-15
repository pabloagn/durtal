# Task 0626: On a wide screen the book stands beside an open drawer

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Finding 6 of the reader audit (SLN-728). From 1024px up the reader's
drawers (Contents, Search in book, Highlights and notes) and the Reading
settings sheet are not modal, so the book stays usable beside them, but
the book did not move: a 360px drawer covered the text under it (at 1440 in
Chromium, 19 of 41 lines of the EPUB and 27 of 83 of the text PDF).

## Implementation Details

- `src/components/reader/side-panel.tsx`
  - The open panels that leave the book usable already sit in one list; each
    entry now records its side (the settings sheet is always on the right).
  - `subscribeReaderPanelInset` publishes how far the book insets from each
    side: the drawer's width (`READER_PANEL_WIDTH`, 360) on the side of every
    such panel, 0 when none is open. Modal panels (phones and tablets under
    1024px) never inset the book; they cover it as before.
- `src/app/reader/[ebookId]/reader-view.tsx`: the book frame takes those
  insets as its left and right. The engines already reflow on a resize of
  the frame and keep the anchor, so the text reflows beside the drawer and
  closing it gives the full width back on the same place.
- `src/components/reader/search-panel.tsx`: the drawer no longer moves to the
  other side of a hit that it would cover, since no hit can be under it; the
  `hitRect` prop goes. On a phone it still closes onto the hit.
- `src/vendor/foliate-js/paginator.js` (patch 30, `VENDORED.md`): a resize
  kept the place except at a chapter's end. The same happened on main with a
  window resize; the drawers make it a resize on every open and close.
  - The chapters loaded before the current one re-lay out after the
    paginator has scrolled to the anchor, sliding every page after them, and
    only the current chapter's re-layout went back to the anchor: in Firefox
    each narrowing and widening moved the place on a page (pp. 22-24 became
    27-28 after three drawers). Now an earlier chapter's re-layout goes back
    to the anchor too.
  - On a spread two chapters share, the settle took an anchor beginning in
    the second chapter as off screen and replaced it, scrolling placed a
    range anchor by the wrong chapter's offset, and a screen showing only
    the first chapter's blank end made the place that chapter's start. The
    anchor is now measured, placed and read in its own chapter.

## Completion Notes

- Drawer check in Chromium, WebKit and Firefox at 1440, 1024 and 390, on the
  EPUB, the text PDF and the comic, for each of Contents, Search in book,
  Highlights and notes and Reading settings: at 1440 and 1024 no text and no
  page lies under the drawer, the book insets 360px on the drawer's side,
  and closing it restores the full width on the same page. At 390 the
  drawers cover the book as before. 0 alignment deviations with a drawer
  open.
- Chapter-end check (three drawers opened and closed on pp. 22-24 and on a
  chapter's first page, after a fresh open): the place holds in all three
  engines; before patch 30, Firefox moved on a page each time and WebKit
  went back one. `reader-engine-check.mjs` gains a drawers row for this
  (Contents opened and closed three times on a chapter's first page after a
  reopen); 281 of 281 rows pass.
- `page-weight.js`: the reader within its budget.
- Tests: `side-panel.test.ts` (the inset beside a drawer open on a wide
  screen, never on a phone or tablet) and `search-panel.test.ts` (the drawer
  stays on its side as hits are picked).
- No migration and no new packages.

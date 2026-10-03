# Task 0205: Hover-only controls show with keyboard focus

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Fifteen controls and hints were `opacity-0` until the mouse hovered their card or tile (`group-hover:opacity-100`), with no focus rule, and one more (the taxonomy drag handle) used `group-hover:opacity-60`. Tab reached them, but they stayed invisible, and the rose focus ring was invisible with them. Each one now shows when it has keyboard focus. The global ring (`:focus-visible`, `src/styles/globals.css`) is unchanged.

## Implementation Details

One pattern for each case:

- Opacity on the control itself: `focus-visible:opacity-100`.
  - `src/app/locations/location-card.tsx`: edit and delete buttons.
  - `src/components/books/media-manager-dialog.tsx`: select checkbox, delete button.
  - `src/components/media/author-media-manager-dialog.tsx`: select checkbox, adjust button, delete button.
  - `src/components/media/media-gallery.tsx`: delete button.
  - `src/components/taxonomy/taxonomy-item-row.tsx`: drag handle. It is `group-hover:opacity-60`, so the `group-hover:opacity-100` search missed it, but dnd-kit makes it a focusable button (`tabindex=0`, keyboard sensor).
- Opacity on a wrapper of the control: `focus-within:opacity-100`, as the book card copy button already did.
  - `src/components/authors/author-card.tsx` and `author-list-item.tsx`: actions menu.
  - `src/components/books/book-card.tsx`: actions menu.
  - `src/components/activity/comment-item.tsx`: Edit and Delete.
- Hint inside a control: `in-focus-visible:opacity-100` (Tailwind 4 `in-*`: shows when an ancestor has keyboard focus).
  - Both media managers: the "Set active" overlay inside the thumbnail button. `group-focus-within` would keep it over a tile after a mouse click on that tile's checkbox, because Chrome focuses a clicked button.
- Hint beside a control: `group-focus-within:opacity-100`.
  - `src/components/media/media-gallery.tsx`: the caption shows while the tile's delete button has focus.

Left alone: the two sites that already had a focus rule (book card copy button, taxonomy row menu). The sidebar tooltip in `src/components/layout/sidebar.tsx` no longer uses the pattern on this branch (SLN-390 replaced it).

## Completion Notes

Verified on :3100 (1024x768, built-in browser) with the real Tab key: each control reached by Tab, `:focus-visible` true, effective opacity 0 before focus and 1 with focus, ring `1px solid rgb(125, 61, 82)` (accent rose).

- `/locations`: edit and delete buttons. Ring offset -1px there: `CapAligned` clips with `overflow-hidden` and sets `-outline-offset-1` (unchanged).
- `/authors` grid (author card) and list (author row): actions menu.
- `/library`: book card actions menu. The copy button beside it hides again when focus moves on.
- `/taxonomy/subjects`: drag handle.
- Book media dialog (A Book of Memories, from the book card menu): select checkbox, delete button.
- Author media dialog (A.A. Milne): select checkbox, adjust button, delete button.
- The dialogs are modal `<dialog>` elements in the top layer, so the card wrapper's `opacity-0` around them does not hide them.

Not reachable with live data, so checked on a copy of the exact markup injected into the live page (served CSS, real Tab key):

- "Set active" hint: no book or author I opened had a second poster or background. The hint goes to opacity 1 when its thumbnail has keyboard focus and stays 0 for the checkbox. After a mouse click on the checkbox (focus but not focus-visible) the hint and checkbox stay at 0.
- Comment Edit and Delete: no comment on the pages I opened. Both show while either has keyboard focus.
- Gallery delete button and caption: `MediaGallery` renders only from `WorkMediaSection`, which no page imports. Delete and caption both show when the delete button has keyboard focus.

`scripts/qa/alignment-audit.js`: 0 deviations on `/locations` (15 icons), `/authors` grid and list (23), `/library` (26), `/taxonomy/subjects` (117), `/authors/a-a-milne` (20), `/library/a-book-of-memories-by-peter-nadas` (25). The change is opacity only, so no box moved.

Re-run with the probe version of the audit (0206): the same counts and 0 deviations, except 5 rows on `/library` at 1024px wide: the toolbar icons +10.09px from "Recent". That is a false positive. The probe's inline-block gives the line a break opportunity, and "Recent" (`white-space: normal`, 57px shrink-fit button) wraps after its "R". Measured without the probe, the icons sit 0.09px from the cap center of "Recent". The toolbar is not part of this change.

`pnpm typecheck` and eslint on the 9 changed files pass.

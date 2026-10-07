# Task 0397: The optional review notes on #155, #156 and #157, and a person's nationality link on touch

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: 0374, 0375, 0377
**Blocks**: None

## Overview

SLN-547. The code review left one optional note on each of three PRs that
have landed: a changelog that gives one measurement twice (#155, 0374), the
"Start reading" label on a narrow Up Next list sitting 10 px right of the
title above it (#156, 0375), and the sidebar's resize handle lying over the
right edge of the rail's touch press areas (#157, 0377). A fourth from the
same sweep: on a person's page the nationality link was a 24 px tap target
on touch.

## Implementation Details

- `changelog/0374_TASK_person-card-names-and-provenance-letters.md`: the
  order panel's header buttons were 3.44 px off in one bullet (the review's
  data) and 3.13 px in the next (the newest backup). One bullet now gives
  the backup's figure, the sizes on touch and the result after the fix.
- `src/components/reading/queue-list.tsx`: on a narrow list (under 34rem),
  where "Start reading" goes under the row's text, the button takes
  `-ml-2.5`, its own padding, so its label starts on the title's left edge.
  Its hover background reaches 10 px into the 12 px gap beside the cover.
  The wide list, where the buttons sit beside the title, is unchanged.
- `src/components/layout/sidebar.tsx`: the resize handle takes
  `pointer-coarse:hidden`. With a coarse pointer it no longer covers the
  last 0.5 px (the logo's last 1.4 px) of each 44 px press area in the
  56 px rail, so a touch there follows the link instead of starting a
  resize. With a mouse it shows and works as before. `pointer-coarse:hidden`
  comes after `md:block` in the compiled CSS, so it wins at every width.
- `src/app/people/[slug]/author-detail-header.tsx`: the nationality link
  takes `touch-hit`, a press area at least 44 x 44 px on a coarse pointer.
  The link and its line keep their size, with a mouse and on touch.

No schema change, no new package.

## Completion Notes

- A production build on the preview's synthetic catalogue
  (`--seed-large 50`) with five books in Up Next, one with a note, in
  headless Chrome 141, Firefox 142 and WebKit 26 (Playwright 1.56.1):
  - `/reading/next` at 390 px, mouse and coarse: every row's label starts
    0.00 px (WebKit 0.01 px) from its title's left edge; the review measured
    10 px on main. At 1440 and 768 px the buttons stay beside the title with
    no margin.
  - The sidebar on `/library`: the handle is hidden with a coarse pointer at
    1024 px (full sidebar and rail) and 768 px (rail), and shown with a
    mouse at 1440 (full) and 1024 px (rail). A point 1 px inside the right
    edge of each control's press area (the logo, Search and the 18 links)
    lands on that control in every case: 20 of 20. The review found all 20
    hitting the handle in the rail on main.
  - A person's page, with two people added: A. A. Milne (United Kingdom,
    1882-1956) and Koulsy Lamko (Chad, a name narrower than 44 px). The
    link is 24 px high, as before, with a mouse and on touch. On touch at
    1024 and 390 px its press area is 44 px high (123 x 44 and 44 x 44 px),
    a point 1 px inside each of its four edges lands on the link, and it
    ends 12 px clear of the dates beside it. With a mouse at 1440 and 768 px
    there is no press area beyond the link.
- `alignment-audit.js`, `design-audit.js`, `overflow-audit.js` and, at
  390 px with a coarse pointer, `touch-audit.js` on `/`, `/library`,
  `/reading/next` and both person pages at 1440, 768 and 390 px in the
  three browsers: every page load finds nothing.
- `page-weight.js`: every route passes (`/reading/next` 67 / 300 KB,
  `/people` 211 / 300 KB). `phone-audit.mjs` finds no page scrolling
  sideways; `interaction-audit.mjs` on `/reading/next`, `/library` and
  `/people/a-a-milne` finds no failure.
- Typecheck clean. Lint: 0 errors, 77 warnings as on main. `pnpm deadcode`
  clean.

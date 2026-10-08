# Task 0394: The interaction audit skips what a closed history hides

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-544. `scripts/qa/interaction-audit.mjs` reported "Enter on button
"Actions" opens no menu" six times on a painting page. The six menus are the
Actions of an original's location history, which the page folds into a
closed `<details>` when it has more than three entries
(`src/components/paintings/art-objects-section.tsx`). A browser does not
render what a closed `<details>` holds: those buttons cannot take focus or a
press until the reader opens the history, and then Enter and Space open their
menus as on book and film pages. The audit took them as shown, because they
keep a box and no ancestor is `display: none`, so it focused nothing and
pressed Enter on the page. No change to the app.

## Implementation Details

- `__ia.hidden` asks `checkVisibility()` first: false for anything a closed
  `<details>` folds away (and for what `display: none` hides), in Chrome,
  Firefox and WebKit. The keyboard, menu and dialog checks use it.
- The touch check leaves those controls out the same way, so a folded row is
  never measured against the one beside it.

## Completion Notes

- Reproduced on a preview of main (9a4cde70) with the large seed: of the
  painting page's eight Actions buttons, the six in the folded history had
  `checkVisibility() === false`, took no focus and answered no click. With
  the history opened (Enter on its summary), Enter and Space on a row's
  Actions open its menu in headless Chrome, Firefox and WebKit.
- The audit with the fix, on every page with an Actions menu: a book, the
  library, a person, people, a publisher, an organization, a venue, a series,
  a recommender, a film, a perfume, a painting and the taxonomy. Every menu
  opens on Enter, takes focus, moves on ArrowDown and closes on Escape. The
  one finding left is the film page's "In the collection" link (20px beside
  the rating), which SLN-376 (task 0391) fixes.
- The painting page passes the alignment, design, overflow and touch audits
  in headless Chrome, Firefox and WebKit at 1440, 768 and 390px.
- Typecheck clean; lint 0 errors and 77 warnings as on main; deadcode
  clean; `scripts/qa/test-local.py` 263 files, 2,958 of 2,958 passed.

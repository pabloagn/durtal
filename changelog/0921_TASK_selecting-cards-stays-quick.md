# Task 0921: Selecting cards stays quick

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1249, from findings/responsiveness-survey-2026-10-19.md (suggested
ticket 1). On /library every selection change redrew every card: at 192 cards
and 4x CPU, Select all took 0.8 s, entering selection 1 to 2 s to settle, and
leaving it froze the page for up to 1 s after Escape.

## Implementation Details

- `src/components/books/book-card.tsx`: `BookCard` is memoised and draws only
  its frame (the ring, the checkbox and the click that picks it). Everything
  else is `CardBody`, memoised on the card's own fields, so a tick or Select
  all never redraws it.
- The mode reaches the two parts it changes through a per-card context:
  `CardCover` (the cover link's pointer and focus, the cover menu gesture and
  the actions) and `CardTextLink`. Their children come from `CardBody`, so
  they are not drawn again.
- The actions stay mounted while selecting and are hidden with
  `display: none` (the `artwork-actions` utility sets `display: flex`, so a
  class could lose to it). Before, leaving selection mounted Copy and the
  menu, with its dialogs, on every card at once: the long task after Escape.
  `CardActions` is memoised, so it redraws only when its menu opens or closes.

## Completion Notes

- `card-selection-renders.test.ts` renders 192 cards: entering selection,
  a tick, Select all and leaving draw no card text, info or menu again, and
  leaving mounts no menu; a tick rings only its card. Both tests fail on the
  previous card. `card-reading.test.ts` now checks the actions are hidden,
  not removed, while selecting.
- Headless Chromium, Firefox and WebKit at 1440, 390 and 320: entering hides
  every card's actions and leaves no card link focusable; a click picks one
  card and stays on /library; Select all ticks every card; Escape clears and
  shows the actions again; the card menu and the cover's right-click menu
  open afterwards; the cover link navigates. Alignment, design and overflow
  audits clean while selecting and after.
- The 4x CPU timing at 192 cards needs the 5,000-book scale seed, which this
  container could not load; the render counts stand in for it.
- Review (findings/review-pr-563.md): most of each slow frame was a forced
  restyle of the whole page, caused by six `:has()` rules in the shared
  layout that matched nothing while selecting. All six are replaced:
  - a menu's icon column: an item with an icon tells its menu
    (`showIcon` in `DropdownMenuContext`, before paint), which sets
    `data-icons` on the list, and `.dropdown-list[data-icons]` makes the
    16px column;
  - the sidebar's timer slot: the rail and expanded timer chips are 100px
    themselves, so the slot needs no rule;
  - the phone's card size control: the rows holding the view switch
    (`EntityFilters`, the e-book filters, `CollectionsViewSwitcher`) carry
    `data-view`, and the four phone rules read `[data-view="grid"]`.
- After the change, with the reviewer's scripts on 192 cards at 4x CPU
  (about 400 imported books): the forced restyle is 18-48 ms on a pick
  (300-670 ms before), 163-248 ms on Enter and 374-453 ms on Select all;
  INP is 240-256 ms for a pick (616-688 ms on main in the review). Menus
  with icons keep a 16px column and menus without one none; the phone's
  card size control is chosen in the server's HTML on /library and /films
  at 390 and 320; the timer slot is 100px with a running timer, expanded
  and rail, and empty without one; Chromium, Firefox and WebKit, audits
  clean.

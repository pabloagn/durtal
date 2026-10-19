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

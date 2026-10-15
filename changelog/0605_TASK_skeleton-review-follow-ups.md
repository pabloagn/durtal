# Task 0605: Loading screens, the review's follow-ups

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: 0600
**Blocks**: None

## Overview

Follow-ups from the review of #284 (SLN-698, loading screens that match their
pages). On a phone, a film with a short title moved its facts up 64px when it
arrived at 390, and a publisher moved its facts down 52px at 320, because its
star, Edit and menu were not drawn. The book page's header could also show a
different cover from the book's card.

## Implementation Details

- **`SkeletonTitleRow`** (`src/components/shared/skeleton.tsx`) takes
  `row`, the `DetailTitleRow` variant of the page it stands in for (`wide`
  for the book, `standard` for the publisher). It wraps where that row wraps,
  with no gap under the title.
  - Below the row width where that rule stops wrapping (24rem for the
    publisher; 33rem with a mouse and 39rem on touch for the book), the title
    line takes the row and the actions go under it, as they do for every
    title but the shortest. From that width on they stay beside it.
  - So a very short book title with a mouse in a 640 to 768px window ("The
    Abyss") still lands 52px higher: keeping the actions beside it there
    would move nearly every other book instead (20 of 24 in review, against
    4 with this rule).
- **Without `row`** (the film and the painting, whose `stacked` row keeps a
  one-line title's star and menu beside it), the skeleton draws a title that
  fits on one line, with its star and menu beside it at every width (72px,
  96px on touch).
  - Before, the actions were drawn under the title on a phone, so a short
    title's facts moved up 64px. A long title takes more lines, which no
    loading screen can know.
- **Publisher**: the loading screen draws its title row with the actions.
- **The book header's cover**: with no poster, the header shows the cover of
  the edition the book's card shows. That is the earliest added edition
  (`cardEdition`, `library/[slug]/card-edition.ts`, the order `getWorks` uses).
  - Before, the header took the first edition with a cover in the page's
    order (newest publication first), so it could differ from the card.
  - The header now shows a placeholder exactly when the card does.

## Completion Notes

- `src/__tests__/catalogue/card-edition.test.ts`: the earliest added, a tie
  broken by id, none for a book with no editions.
- Measured on a production build, page held 4 s after a tapped link, in
  Chromium, Firefox and WebKit:
  - Book: "The Abyss" and "The Magic Mountain" at 1440, 1024, 390 and 320
    land at 0px, apart from "The Magic Mountain" at 320, whose title takes a
    second line (52px). At 640 to 768px see above.
  - Film: the facts start at 0px at 1440 and 390.
  - Publisher: the body starts at 0px at 1440 and 320. "Gallimard" fits
    beside its actions at 390, so there it lands 52px higher.

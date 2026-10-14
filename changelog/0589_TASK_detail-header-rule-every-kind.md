# Task 0589: Detail header on a phone, the shared rule, on every detail kind

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0587
**Blocks**: None

## Overview

SLN-641 design contract, section 12, piece 2. The person, film, painting,
perfume, organization, place and series pages take the detail header row
from piece 1 (0587): under a long title on a phone the controls start on
the title's left edge, the star's icon lined up with it, and the title
keeps the row's width. CSS alone decides, so nothing moves after the first
paint. Each kind keeps its own breakpoint, so no header is taller than on
main.

## Implementation Details

- **`DetailTitleRow`** (`src/components/shared/detail-layout.tsx`) takes
  `controls`, one of five row rules, in place of `wideControls`:
  - `standard`, the publisher (as before): under the title below a 24rem row.
  - `wide`, the book (as before): below 33rem, 39rem on touch. A screen that
    reports neither mouse nor touch now takes the mouse's width
    (`not-pointer-coarse`, the #283 reviewer's note); before it never held
    the controls beside the title.
  - `icons`, an organization's menu and a place's star and menu: beside the
    title from a 14rem row, as before.
  - `stacked`, a film, painting or perfume: under a title too long for them
    below `sm`, where the header stacks over its image, as before.
  - `free`, a person and a series: under any title too long for them, as
    before.
  The gap is 12px everywhere but the publisher (16px, from #260).
- **`DetailControls`**: the controls' cap-aligned box with the star's
  padding pulled out, now separate from the row so the film, painting,
  perfume, organization and place action components render it themselves.
- **Person header**: the real name moved under the row, so the controls sit
  beside the name only.
- **Series page**: the controls sat beside the whole header block (title,
  original title, authors, badges). They now sit beside the title, and the
  rest follows under the row.
- **Place page**: the favourite is passed into `VenueActions`, so the star
  and menu share one `DetailControls`.

## Completion Notes

- Measured the title row, the header and the top of the first section after
  it, with the contract's fixtures (a 90-letter title, a 32-letter word, "Ada
  or Ardor: A Family Chronicle", "Nadja"), on all nine detail kinds in
  Chromium, Firefox and WebKit at 1440, 1024, 768, 640, 430, 390 and 320,
  touch below 800, against main from before piece 1 on the same database
  (84 each, 756 in all).
  - No header is taller and no first section starts lower than on main.
  - Shorter, by where the first section starts: a wrapped title no longer
    leaves a 12px gap above the controls under it (30 film, 30 painting, 30
    perfume, 41 person and 60 series measures). The series header no longer
    pushes its authors and badges under the controls: 64px higher in 11
    more.
  - The organization, place and publisher pages measure the same as main;
    the book page measures as it did in piece 1.
  - Under a wrapped title the star's icon is 0px from the title's edge in
    every case (273 wrapped headers).
  - The title's box is the same at load and 2s later in every run; no page
    scrolls sideways.
- A first try held the controls beside the title from a set width on every
  kind. It made 37 film, painting, perfume, person and series headers
  taller than main, where main lets a long title push them under; those
  kinds keep main's wrapping.

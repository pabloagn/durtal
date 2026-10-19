# Task 1074: A tap leaves no hover behind, and the Settings menu fits a phone held sideways

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: 1072
**Blocks**: None

## Overview

SLN-1223, from items 3 and 5 of `findings/phone-quirks-survey-2026-10-18.md`
and finding 5 of `findings/hover-and-touch.md`.

- A touch screen keeps `:hover` on what was tapped last. After tapping "Show
  as table" on Statistics, the button stayed lighter until the next tap, and
  a tapped card kept its hover shadow on going back.
- At 844×390, the sticky Settings menu was 408px tall, so Data, Shortcuts and
  About started below the screen.

## Implementation Details

- **Hover waits for a pointer that can hover** (`globals.css`). These rules
  now sit inside `@media (hover: hover)`:
  - `card-interactive`, `text-command`, `input-open` and the cover's chip
    buttons;
  - links in prose and in biographies;
  - the scrollbar thumb, the crop sliders' thumbs and the toast's close
    button.
- **Sonner's own hover** on the close button reads its colours from
  variables. On touch (`hover: none`) they are transparent, so a tapped close
  button keeps its resting look.
- Harmonize's eight hover rules are left to SLN-1110, and the vendored PDF
  styles are left alone.
- **The Settings menu** (`settings-nav.tsx`) stays sticky beside the
  settings. It is never taller than the screen and scrolls inside when it
  would be. A 4px pad keeps a focused link's outline in view, and the links
  keep their place.

## Completion Notes

- **Browsers.** Checked on a private preview in Chromium, WebKit and Firefox:
  - With touch at 390×844, a card and "Show as table" hold `:hover` after a
    tap, with no change to their look.
  - With a mouse at 1440, the button turns lighter (rgb(197, 202, 203) from
    rgb(140, 159, 174)) and the card shows its shadow.
  - At 844×390 with touch, on Settings > Data, the menu is 350px tall
    (24px to 374px), scrolls inside, and each of its 8 links can be reached
    at the top, the middle and the end of the page. At 1440×900 and 1024×500
    it doesn't scroll, as before.
- **Audits**:
  - The browser audit passes 45 of 45 loads: `/settings`,
    `/settings/data`, `/people`, `/library` and `/statistics` at 1440, 390
    and 320 in three browsers.
  - At 844×390 with touch, the alignment, design, overflow and touch audits
    are clean on `/settings`, `/settings/data`, `/people` and `/library` in
    three browsers.
  - Page weight passes every route.
- **Test** (`ui/touch-hover`):
  - It reads every stylesheet but the vendored ones and lists any `:hover`
    outside `(hover: hover)`. Only Harmonize's are allowed, and a sample file
    shows it finds one.
  - It also covers the toast's close button on touch and the Settings
    menu's height.

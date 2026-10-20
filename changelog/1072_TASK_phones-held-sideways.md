# Task 1072: Phones held sideways show records first and no key hints

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1149, from items 4, 5 and 6 of `findings/phone-pass-survey-2026-10-18.md`.

- On touch screens, the palette's footer showed "↑ ↓ move · ↵ open · Esc
  close", and the sidebar's Search showed "⌘K" on a phone held sideways.
- At 844×390, the desktop layout kept the 224px sidebar open, and Library's
  first screen was all controls: the first cover started at 463px.

## Implementation Details

1. **Key hints only with a fine pointer**:
   - The palette's footer and each palette row's keys show only with a mouse
     or trackpad (`pointer-fine:`). They no longer depend on the width.
   - The sidebar's "⌘K" shows from md up with a fine pointer only.
2. **A phone held sideways** is touch on a screen 600px tall or less. It has
   one variant, `sideways:`, in `globals.css`.
   - **The sidebar** starts as the 56px icon rail
     (`use-sidebar-preference.ts`), as a narrow tablet's does, and an
     explicit choice still wins on that browser.
   - **The sort**: lists use the phone's sort menu and direction button in
     place of the chips (`entity-filters.tsx`).
3. **The book's Actions menu** already opens toward the larger space
   (`placeMenu`). At 844×390, it opens below the button, which has 225px
   below and 121px above, and its list scrolls. No change.

## Completion Notes

- **Browsers.** Checked on a private preview in Chromium, Firefox and WebKit,
  with a mouse at 1440 and with touch at 390, 320 and 844×390:
  - With touch, neither the sidebar nor the palette shows a key. With a
    mouse, the sidebar shows ⌘K and the palette shows its footer and row
    keys.
  - At 844×390:
    - The sidebar is the 56px rail, and Library uses the sort menu.
    - Library's first cover starts at 355px, and People's first card at
      295px (351px in WebKit), both within the 390px screen.
    - The book's Actions menu opens below its button, toward the larger
      space.
- **Audits**:
  - The browser audit passes 36 of 36 loads: `/`, `/library`, `/people` and
    `/films` at 1440, 390 and 320 in three browsers.
  - At 844×390 with touch, the alignment, design, overflow and touch audits
    are clean in all three browsers on those four pages and a book page.
  - Page weight passes every route.
- **Tests**:
  - `ui/sideways-phone`: the variant, the fine-pointer hints and the rail
    query.
  - `ui/library-sort`: a short list's chips give way to the menu when the
    phone is held sideways.

### Review on current main (2026-10-20)

- **Where a fine pointer is attached.** The key hints use
  `any-pointer-fine:`, not `pointer-fine:`. A tablet whose main pointer is
  touch still shows them once a trackpad or mouse is attached, and a phone
  shows none.
- **The palette's Read action.** Its ⌘↵ still showed by width alone; it
  now follows the same rule, on the selected row from sm up.
- **Not changed here:** the server draws the open sidebar, and a phone
  held sideways or a narrow tablet shrinks it to the rail after hydration,
  as narrow tablets already did. Filed as SLN-1509.
- **Tests:** `ui/sideways-phone` pins the Read action's rule too;
  `ui/catalogue-ebook-actions` follows its new class.

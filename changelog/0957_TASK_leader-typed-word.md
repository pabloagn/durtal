# Task 0957: A word typed fast after a leader key makes nothing

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

In WebKit on Linux, where ⌘K doesn't reach the palette, a search typed as "nandu" went to the page. N opened New, A picked Add person, "ndu" went into the name field, and Enter saved a person called "du". Source: findings/regression-sweep-2026-10-18.md, "Smaller things". Fixes SLN-1190.

## Implementation Details

- `src/components/shortcuts/shortcuts-provider.tsx`: a pick marks a settle window. A pick here is a leader menu item, or A then a key that adds or runs something.
  - While the window is open, any printable key or Enter that comes less than 350 ms after the one before extends the window, up to 2 s after the pick.
  - In that window a capture-phase listener drops Enter, and printable keys that would act on the page, so they neither save the dialog the pick opened nor open a leader menu again behind it. A letter typed into a text field goes through: a name typed straight after N then A is kept (the second reviewer's change).
  - Keys with ⌘, Ctrl or ⌥, Escape and keys during an input method composition pass through.
- `docs/15_KEYBOARD.md`, Leader menus: says the same.
- Tests:
  - `new-menu-and-add-keys.test.ts`: a fast "nandu" and Enter are dropped, with no menu opened again; letters typed into the name field the pick opened go through and its Enter is dropped; a key after a pause acts; keys at a person's pace act; the dropping ends 2 s after the pick. Two of these fail without the change.
  - Three existing tests that pressed two pairs back to back now pause between the pairs, as a person does.

## Completion Notes

Checked on a production build in headless Chromium, Firefox and WebKit at 1440:
- "nandu" typed fast and then Enter left Add person open with an empty name, and no person was created. With the second reviewer's change, the name holds "ndu" and still nothing is created; N, A and a name typed straight after keep the name in all three browsers (findings/review-pr-545.md).
- N then A typed at a normal pace opened Add person with its name field empty and focused, and typing after that filled it.

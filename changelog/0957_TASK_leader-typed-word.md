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
  - While the window is open, a capture-phase listener drops any printable key, and Enter, that comes less than 350 ms after the one before. Each dropped key extends the window, up to 2 s after the pick.
  - Dropped keys neither type into the dialog the pick opened, nor save it, nor open a leader menu again behind it.
  - Keys with ⌘, Ctrl or ⌥, Escape and keys during an input method composition pass through.
- `docs/15_KEYBOARD.md`, Leader menus: says the same.
- Tests:
  - `new-menu-and-add-keys.test.ts`: a fast "nandu" and Enter are dropped, with no menu opened again; a key after a pause acts; keys at a person's pace act; the dropping ends 2 s after the pick. Two of these fail without the change.
  - Three existing tests that pressed two pairs back to back now pause between the pairs, as a person does.

## Completion Notes

Checked on a production build in headless Chromium, Firefox and WebKit at 1440:
- "nandu" typed fast and then Enter left Add person open with an empty name, and no person was created.
- N then A typed at a normal pace opened Add person with its name field empty and focused, and typing after that filled it.

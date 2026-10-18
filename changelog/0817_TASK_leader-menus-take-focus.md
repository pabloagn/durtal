# Task 0817: Leader menus take the focus

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

The N, G, Y, E and R menus were silent to a screen reader: the focus stayed on the page, every item had `tabIndex={-1}`, and nothing announced the highlighted item. Tab was swallowed while a menu was open. Source: the shortcuts survey, finding 2. Fixes SLN-963.

## Implementation Details

- `src/components/shortcuts/leader-menu.tsx`: roving focus. The active item has `tabIndex={0}` and the focus, and the focus follows ↑ ↓. A layout effect's cleanup returns the focus to where it was when the menu closes (or blurs the item when nothing had the focus). It runs while the menu is still in the page and before the effects of a dialog the choice opens, so that dialog still returns to the control the reader started from. The item's focus ring gives way to the active highlight it already had.
- `src/components/shortcuts/shortcuts-provider.tsx`: Tab and Shift+Tab move through the items as ↓ and ↑ do; Home and End go to the first and last; Space picks as Enter does.
- `docs/15_KEYBOARD.md`, Leader menus: the new keys and the focus.
- Test: `src/__tests__/ui/leader-menu-focus.test.ts` (four of its five tests fail without the change).

## Completion Notes

Checked on a production build in headless Chromium, Firefox and WebKit at 1440 and 390, for all five menus: the focus lands on the first item, ↓, Tab and Shift+Tab move it, the accessibility tree shows the named menu and its items, and Escape closes the menu in one press with the focus back where it was. E then Work opens Edit work with the focus inside, and Escape from it returns to the control focused before the menu. Alignment audit with the menu open: no deviations. Page weight within budget. `pnpm test`: 6,729 passed.

# Task 0620: Reader shortcuts show key caps

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

The reader's shortcut sheet printed the keys' event names in plain boxes:
"arrowleft", "shift space", "pageup", "alt arrowleft", "escape". Actions
with two shortcuts took two rows. The sheet now draws the app's own key
caps, as the app's shortcuts help does (←, Space, Page Up, ⇧ Space, Alt ←
or ⌥ ← on a Mac, Esc), with one row per action and its shortcuts side by
side: "Previous page: ⇧ Space or Page Up". SLN-725, from the reader audit
of 15 Oct.

## Implementation Details

- `src/lib/shortcuts/shortcuts.ts`, `keyLabel`: the reader's key tokens
  (arrows, space, page up and down, home, end, escape, tab) get their cap
  labels. No other caller used those tokens.
- `src/lib/reader/keymap.ts`: `shortcutRows` folds the keymap into one row
  per group, label and context, with every key of that action.
- `src/components/reader/shortcut-sheet.tsx`: rows as in the app's
  shortcuts help (`KeyCombo`, a hairline under each row, secondary text),
  "or" between two shortcuts. "with selection" is secondary text now,
  not muted, since a reader needs it.
- Test: `src/__tests__/reader/shortcut-sheet.test.ts`.

## Completion Notes

- Measured with the sheet open in Chromium, WebKit and Firefox at 1440,
  390 and 320 px: alignment audit no issues, design audit no low contrast,
  no overflow, touch audit no issues (Chromium and WebKit with touch), and
  one Escape closes the sheet.
- No migration and no new packages.

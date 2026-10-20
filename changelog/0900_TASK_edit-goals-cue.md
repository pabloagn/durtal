# Task 0900: "Edit goals" carries its pencil, so it reads as a command at rest

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1047, from a layout audit run. On /reading, "Edit goals" beside the
"Goals this year" heading is a ghost button. At rest it had no box, border,
underline or icon, in a text colour 1.5:1 from the heading's, so only hover
told it apart from text. The layout audit flagged it as a plain command.

## Implementation Details

- `GoalDialogButton` (`src/components/reading/goal-dialog-button.tsx`) shows
  a Lucide pencil before its label when it is a ghost button, as the house's
  other ghost buttons with an icon do. The boxed buttons, in Settings >
  Reading and on Statistics, are commands already and are unchanged.
- The button's right edge stays on the section's edge; it grows to the left
  by the icon and its gap (22px).

## Completion Notes

- **In the browser** (survey dump, /reading), Chromium, Firefox and WebKit
  at 1440, 390 and 320:
  - the layout audit reports no plain command on /reading, where main
    reports "Edit goals" in all three engines;
  - the alignment audit reports nothing; the button's middle is on the
    heading's middle and its right edge is where it was;
  - no page scrolls sideways.
- **Unit test** (`ui/goal-dialog`): a ghost button carries its icon, a boxed
  one does not.
- **Audits.** The browser audit passes 27 of 27 loads of `/reading`,
  `/reading/stats` and `/settings/reading`. Page weight passes on every
  route; `/reading` is 168 of 300 KB.

### Review on current main (2026-10-20)

- The icon follows what the button does: a pencil to edit this year's
  goals, a plus to set a first one. The button sizes it (16px, as every
  icon in a Button) and it is hidden from screen readers, since the label
  names the button.
- `ui/goal-dialog` checks the icon comes first, is hidden, and is a plus
  for "Set a reading goal".

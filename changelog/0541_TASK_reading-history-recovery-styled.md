# Task 0541: The reading history recovery page uses the app's layout

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-692 (found by the SLN-641 design audit). Recover eBook reading history, which Reading settings links to, rendered with no app styling: black serif on white, no sidebar, no fonts. Its route sat at `src/app/settings/reading/ebooks/`, outside the `(catalogue)` group whose layout loads the styles and the shell.

## Implementation Details

- The page moves to `src/app/(catalogue)/settings/reading/ebooks/` at the same URL. It now shows in Settings, with Reading marked in the settings menu (`SettingsNav` marks a section on its own pages too).
- `reader-history-recovery.tsx` uses the design's pieces:
  - a "Back to Reading settings" link;
  - a `SectionHeading` with the explanation as its description, under the Settings title;
  - one panel per book, in the settings group style, with the book title in `type-item-title`;
  - field labels in `type-label`;
  - fields in the input style, 44px on touch;
  - the operations list as a settings panel.
  - The recovery and undo logic is unchanged.
- Reading settings: "Review reading history" is a secondary button link. It was a 24px-tall underlined text link, the only touch-target failure on main.

## Completion Notes

- Checked on a disposable preview with 9 synthetic e-books (3 linked) and preserved history for the 3 linked ones. In headless Chromium, Firefox and WebKit at 320, 390, 1024 and 1440:
  - no overflow, no alignment deviation, no touch failure, no contrast failure;
  - only the seven type sizes.
- Add selected history recovered 2 readings, and Undo removed them, on the disposable database.
- Page weight passes.

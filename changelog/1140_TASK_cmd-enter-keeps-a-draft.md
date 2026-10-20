# Task 1140: ⌘Enter keeps a draft that cannot save

**Status**: Completed
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1054. When a form with unsaved work could not save (a required field
emptied), the Unsaved changes question made Discard its primary button.
⌘Enter presses a dialog's last main button, so trying to save from the
question threw the draft away.

## Implementation Details

- `UnsavedChangesPrompt` (`src/components/ui/dialog.tsx`): Discard is always
  secondary. While the form cannot save, Keep editing carries
  `data-shortcut="save"`, so ⌘Enter keeps editing; when it can, ⌘Enter still
  presses Save.
- `docs/15_KEYBOARD.md` says so.

## Completion Notes

`src/__tests__/ui/unsaved-changes.test.ts` asks the question with Save off and
on: ⌘Enter's button is Keep editing (the draft stays and the dialog stays
open) and then Save, and Discard is secondary in both. It fails on the old
prompt. A browser probe presses ⌘Enter on the question in Chromium, Firefox
and WebKit.

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
  presses Save. Whichever takes ⌘Enter names it (`aria-keyshortcuts`). Keep
  editing pulls out by its padding, so its label starts on the question's
  edge.
- `docs/15_KEYBOARD.md` says so, and gives Save's key as ⌘Enter: focus starts
  on Keep editing, so plain Enter keeps editing.

## Completion Notes

`src/__tests__/ui/unsaved-changes.test.ts` asks the question with Save off and
on: ⌘Enter's button is Keep editing (the draft stays and the dialog stays
open) and then Save, and Discard is secondary in both. It fails on the old
prompt. A browser probe in Chromium, Firefox and WebKit, at 1440 and 320,
empties a collection's name, presses ⌘Enter on the question and finds the
draft kept, then puts the name back and finds ⌘Enter saving; the alignment
and design audits run with the question open.

Self-review (code-review, high) found the ghost Keep editing not pulled out
to the text edge, no key named on it, and docs/15 giving Save as Enter; all
fixed. It also noted that ⌘Enter falls back to any dialog's last primary
button; every other primary is a confirmation, so that stays.

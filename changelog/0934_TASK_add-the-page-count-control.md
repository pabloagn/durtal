# Task 0934: Add the page count control

**Status**: Completed
**Created**: 2026-10-18
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1102. An open reading with no page count showed "Add the page count for an estimate": on the book page a button that read as an instruction and opened Edit reading at its first field, and on the reading cards the same instruction with nothing to press.

## Implementation Details

- `lib/reading/pace.ts`: with nothing to measure, the estimate is a plain sentence, "No estimate without a page count", or "No estimate without the audio length" for an audiobook. `ReadingEstimate.addLength` names the book page's control: "Add the page count" or "Add the audio length".
- `components/reading/estimate-line.tsx`: the sentence is text everywhere. On the book page a link-style button follows it, underlined at rest and 44px tall on touch.
- `components/reading/reading-section.tsx` opens Edit reading with `focusLength`. `components/reading/dialogs/edit-reading-dialog.tsx` marks Pages to read, or Audio length for an audiobook, with `data-dialog-focus`.
- `components/ui/dialog.tsx`: a dialog starts in its field marked `data-dialog-focus` when it has one, otherwise in its first field as before. No other dialog marks a field.

## Completion Notes

- Tests: `reading/pace.test.ts` (the sentence and the control's words for print and audio) and `ui/unsaved-changes.test.ts` (a dialog starts in its marked field, otherwise its first).
- Browser, in Chromium, Firefox and WebKit at 1440 and 390, on a seeded preview with a print and an audio reading imported without lengths:
  - The book page read "No estimate without a page count" and "Add the page count" (the audiobook, checked in Chromium: "No estimate without the audio length" and "Add the audio length"). Enter on the control opened Edit reading with the focus in Pages to read (Audio length for the audiobook); Escape put it back on the control.
  - The Reading cards read the sentence alone, with no button.
  - The sentence and the control share their text top at 1440 in all three engines; at 390 and 320 the control wraps under the sentence on its left edge, 44px tall.
  - The alignment and design audits are clean on both book pages and Reading at 1440, 390 and 320.
- Page weight passes on every route.

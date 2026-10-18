# Task 0952: Plain Enter no longer deletes a location

**Status**: Completed
**Created**: 2026-10-18
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

The Delete location dialog's Delete was a primary button painted red. Plain Enter presses a dialog's primary, and this dialog has no field, so it opens focused on itself: one Enter deleted the location and every copy kept there. Source: findings/dialogs-survey-2026-10-18.md, section 1. Fixes SLN-1053.

## Implementation Details

- `src/app/(catalogue)/locations/location-card.tsx`: Delete is `variant="danger"`, as every other delete, with the hand-painted red removed. Plain Enter skips a danger button. It carries `data-shortcut="save"`, as the shared delete dialog's does, so ⌘Enter (Ctrl+Enter) still deletes from the keyboard.
- No other dialog paints a primary button red; the new test checks every `variant="primary"` button in `src/`.
- Test: `src/__tests__/ui/location-delete-danger.test.ts` (both fail without the change).

## Completion Notes

Checked on a production build in headless Chromium, Firefox and WebKit at 1440 and 390: Delete location opens focused on the dialog, plain Enter leaves it open and the location in place, and the alignment audit finds no deviation. Clicking Delete deletes it, and so does Ctrl+Enter (Chromium). Page weight within budget. `pnpm test`: 6,794 passed.

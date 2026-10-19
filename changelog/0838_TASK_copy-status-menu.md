# Task 0838: Copy status menu

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1124. A copy's status menu on a book page was a hand-made popover: Escape did not close it, the focus fell to the page after a change, and choosing Deaccessioned deaccessioned the copy on one click with no record of how or when.

## Implementation Details

- `src/app/(catalogue)/library/[slug]/instance-status-button.tsx` is now built on `DropdownMenu`. The trigger carries `aria-haspopup` and `aria-expanded`, is named "Status: …", and keeps the focus; each status is a radio item, the current one checked.
- Lent out opens a "Lend this copy" dialog with "Lent to"; Enter lends. It records the name and today's date, as before.
- Deaccessioned opens a "Deaccession this copy" dialog: disposition type, disposition date (today, required) and disposed to. Its Deaccession button is the danger variant, so Enter in a field does not press it. Nothing saves until it is pressed.
- Escape closes one layer per press: the list, or the dialog. The dialogs give the focus back to the trigger, as the menu does after a plain status.
- While saving, the trigger is `aria-busy` and the handler ignores a second change; nothing is `disabled`.
- The saved status shows on the trigger at once, before the page's refresh brings it.

## Completion Notes

- Checked in Chromium, Firefox and WebKit (Escape sent as key code 27 and as a real key): the list, then the dialog, close one per press; after every change `document.activeElement` is the trigger; Enter in the deaccession fields saves nothing; Confirm records the type and date.
- Alignment, design, overflow, layout and touch audits clean on the book page at 1440, 390 and 320, with the menu and each dialog open.
- Test: `src/__tests__/ui/copy-status-menu.test.ts`.

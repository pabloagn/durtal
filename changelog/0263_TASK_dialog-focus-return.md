# Task 0263: Dialogs Return Focus to Their Trigger

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
When any dialog closed, keyboard focus landed on the page body. A keyboard
user had to tab from the top of the page again. The shared `Dialog`
(`src/components/ui/dialog.tsx`) unmounts its content on close, so the
browser's own focus return never ran. Found while checking PR #4; there was no
Linear issue for it.

## Implementation Details
- When a dialog opens, it records the element that had focus. When it
  closes, however it closes (Esc, Cancel, Close, a confirm, or the page
  unmounting it), focus goes back to that element.
- A dialog opened from a menu item opens after the menu is gone, with focus
  already on the body. A `focusin` listener keeps the last focused element and
  the button of the menu that held it, so focus goes back to the menu button.
- Fallback: when neither element is still on the page (the confirm deleted
  the row that held the trigger), focus stays where the browser puts it.
- React's development re-run of effects cleans up and runs again at once,
  after focus is already inside the dialog. The trigger is kept from the
  first run, and the cleanup that the re-run follows does nothing.
- No style changed.

## Completion Notes
- Checked on `next dev` with real key presses (headless Chrome over the
  DevTools protocol): the "Add to collection" button dialog (Esc, Close), the
  Actions menu's Edit Work dialog (Cancel, Close: focus goes to the Actions
  button) and the edition Delete confirm (Cancel). Focus returns to the
  trigger each time. On main, the same Esc left focus on the body.
- Not covered: Esc does not close the Edit Work dialog or the Delete confirm
  in headless Chrome, on main too. It may be a headless effect; worth a check
  in a real browser. The confirm's destructive button was not pressed (no
  live writes); it closes through the same path as Cancel.
- `alignment-audit.js` and `design-audit.js` on the book page, also with two
  dialogs open: 0 alignment issues, 0 low-contrast text. The design audit's
  one nested control (Export inside Export) and one `#ffffff` are on main.

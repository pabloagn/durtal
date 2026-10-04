# Task 0265: One Escape Closes a Dialog

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Esc did not close the Edit Work dialog, and it did not close a dialog while
one of its Select controls had focus. Found while checking PR #47; there is
no Linear issue for it.

## Implementation Details
- Stray tooltip (`src/components/ui/tooltip.tsx`). `showModal` focuses the
  dialog header's first button, and the tooltip layer schedules that button's
  keyboard tooltip. The dialog then moves focus to its first field at once,
  but the scheduled tooltip still appeared, on a button without focus. The
  first Esc went to hiding it (the documented "Esc closes a keyboard tooltip
  first" rule) and never reached the dialog. A scheduled tooltip is now
  cancelled when its control loses focus. The rule itself is unchanged: a
  visible keyboard tooltip on the focused control still takes the first Esc.
- Select (`src/components/ui/select.tsx`). Esc called `preventDefault` even
  with the list closed, so the dialog never saw it. It now does so only while
  the list is open: an open list closes first, a closed one lets Esc through.
- `happy-dom` is a new dev dependency, for component tests.
  `src/__tests__/ui/dialog-escape.test.ts` covers both cases and the kept
  behaviour; the two bug tests fail on main's code.

## Completion Notes
- Keyboard check on `next dev`, real key presses in headless Chrome over the
  DevTools protocol. On main's code: Edit Work showed an "Expand" tooltip and
  ignored Esc, and Esc with a Select focused did nothing. With the fix, one
  Esc closes Edit Work, Edit Work with a Select focused, the edition Delete
  confirm and Add to collection. A keyboard tooltip still shows on focus and
  Esc hides it first. An open Select list closes on the first Esc, the
  dialog on the second.
- The stray tooltip is a race: in one run on main the Delete confirm still
  closed on the first Esc.
- `alignment-audit.js` and `design-audit.js` on the book page and on Edit
  Work with a Select list open: 0 alignment issues, 0 low-contrast text. The
  nested Export control and the off-token colours are on main.
- Focus after close still lands on the body here; PR #47 fixes that.

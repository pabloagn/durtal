# Task 0815: Ctrl+K closes the palette on Windows and Linux

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-962 and SLN-968, from the shortcuts survey
(`findings/shortcuts-survey-2026-10-16.md`, findings 1, 8 and 9). On Windows
and Linux a second Ctrl+K moved the palette's selection up one row instead of
closing it, and Ctrl+N and Ctrl+P never reached the browser while the palette
was open.

## Implementation Details
- `command-palette.tsx`: `vimBindings={false}` on `<Command>`. cmdk's vim
  bindings took Ctrl+J/K/N/P as list moves and prevented them, and the
  shortcuts provider skips a key a handler already took. The arrow keys still
  move through the list; on a Mac nothing changes.
- `docs/15_KEYBOARD.md` (SLN-968): an organization's page has a favourite, so
  its Favourite cell is A F and the note under section 3 says only that it has
  no media; section 2 says Ctrl+K also closes the palette and lists the keys
  the browser shares (`/`, Ctrl+K, Alt+F, and Ctrl+J/N/P inside the palette).

## Completion Notes
- `palette-ctrl-keys.test.ts` renders the palette: Ctrl+K, J, N and P are left
  unprevented and keep the selection (all four fail without the fix), and the
  arrow keys still move it.

# Task 0519: Esc closes a mark's actions after the click that opened them

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0502
**Blocks**: None

## Overview

Found while checking SLN-670 (0502): after a click on a highlight, its
actions ("Highlight actions") opened, but Esc did not close them. The click
left focus in the book, and the reader's Esc there only closed read aloud,
search or full screen. The menu handled Esc only while focus was inside it.

## Implementation Details

- `HighlightMenu` (`src/components/reader/highlight-menu.tsx`) holds a
  surface lease while it is open, as the reader's dialogs do
  (`acquireSurface`). Esc then closes it from the page and, through the
  input layer's `handleSurfaceEscape`, from the book's document.
- While it is open the reader treats it like its other surfaces: the page
  keys wait until it closes.
- Unchanged: with keyboard focus on one of its buttons, the first Esc closes
  that button's tooltip and the second closes the menu, as everywhere.

## Completion Notes

- Checked in headless Chromium, Firefox and WebKit at 1440 on a mark made
  in the reader fixture: with focus left in the book (Chromium, WebKit) one
  Esc closes the menu, which it did not before; with focus on its first
  button (Firefox, and all three when focused on purpose) the tooltip, then
  the menu, close.
- Tests: new `highlight-menu-escape.test.ts` (Esc from the page and from a
  book document through the input layer; the lease is let go on close).
- No migration and no new packages.

## Review fix

- After a mouse click on a mark, the menu's first swatch took focus with a
  visible focus ring in all three browsers, so its tooltip took the first
  Esc and a mouse user still needed two. The first button is now focused
  with `focusVisible: false` unless the mark itself had keyboard focus, and
  Esc or Close put focus back on the mark, or the book's frame.
- Tests: new `highlight-menu-focus.test.ts` (no visible focus after a click,
  visible after the keyboard, focus back on the mark on Esc and on Close).

# Task 0720: Escape asks before leaving the book

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

SLN-744. In the reader, Escape with nothing left to close asks "Leave the
book?". The question is keyboard-driven: Esc then Esc stays in the book,
Esc then Enter leaves. Leaving saves the place first and goes where the
toolbar's back link goes: back through history to the page the reader was
opened from inside the app, else the e-book's own page. EPUB, PDF and
comics alike, also when the focus is inside the book's frame.

## Implementation Details

- `src/components/reader/leave-prompt.tsx` (new): a glass `Dialog` with
  Stay and Leave and the key hints (Esc stay, Enter leave). Leave holds the
  focus, so Enter presses it and Esc closes the dialog. Neither button has a
  tooltip: a focused control's tooltip takes the first Esc, which would make
  Esc twice need three presses. While leaving, Leave is busy and Stay is
  disabled; a return from the browser's page cache closes the prompt.
- `src/app/reader/[ebookId]/reader-view.tsx`: the Esc action keeps its
  order (read aloud, search panel, a side panel, the search itself, full
  screen) and ends with the prompt instead of showing the bars. Full screen
  now takes its own press. The back link's code is now `leave(href)`, shared
  by the link and the prompt, so both save the place and the open sitting
  (`bridge.leave()`) before going.
- `src/lib/reader/keymap.ts`: the shortcut sheet's Esc reads "Close the
  active surface, else leave the book".
- Docs: `docs/15_KEYBOARD.md` (who gets a key) and
  `docs/04_ROUTES_AND_VIEWS.md` (reader keys).
- Tests: `src/__tests__/reader/reader-view.test.ts`, Esc twice from the
  book's frame stays; Leave goes to the back link's page once the place is
  saved. Both fail on main.

## Completion Notes

See the PR for the headless Chromium, Firefox and WebKit results at 1440,
390 and 320.

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
  Leave takes the focus in the commit that opens the dialog, so a quick
  Esc, Enter already finds it.
- `src/app/reader/[ebookId]/reader-view.tsx`: the Esc action keeps its
  order (read aloud, search panel, a side panel, the search itself, full
  screen) and ends with the prompt instead of showing the bars. Full screen
  now takes its own press. The prompt opens a task after the key: a modal
  dialog opened while the key's default action is still to run takes that
  same Esc as its cancel (in a PDF or a comic, where the focus is on the
  page and not in the book's frame, it closed as it opened). The back link's code is now `leave(href)`, shared
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

- Headless Chromium, Firefox and WebKit at 1440, 390 and 320 (touch at
  390 and 320), on a production preview with the reader fixtures, for the
  EPUB 3, the text PDF and the CBZ: Esc shows the prompt with the focus on
  Leave; Esc closes it and the book stays where it was; Esc, Enter leaves
  for the e-book's page and the book reopens at the place it was left;
  opened from the e-book's page, Esc, Enter goes back in history to it;
  Contents and Reader shortcuts close on Esc without the prompt. With the
  prompt open the alignment audit is empty and the design audit finds no
  low-contrast text and no unnamed control; buttons are 44px on touch.
  234 of 234 checks passed.
- Before the fix above, the PDF and comic prompt closed as it opened in
  all three browsers, and a quick Esc, Enter missed Leave twice in WebKit.
- The prompt is the shared `Dialog` at `max-w-sm`: at 390 it is 384px wide,
  at 320 the full width, as every app dialog.
- Page weight: `/reader/<id>` 23 of 400 KB.
- The local full suite ran with no failures for 30 minutes and was stopped
  at the session's time limit (it shared the machine with builds); CI runs
  the database suites.

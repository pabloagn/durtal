# Task 0573: The reader check passes on main again; one Escape closes a dialog

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0571, 0572
**Blocks**: None

## Overview

`scripts/qa/reader-engine-check.mjs` failed eight to ten rows on main. Most
were the check's own: the reading settings changed under it and a fixture
stopped giving the screen a row looks for. One was real: in every dialog,
keyboard focus on a control with a tooltip (the Close button) made the first
Escape close only the tooltip, so a dialog took two presses.

## Implementation Details

- `font`: the font is now a group of radio buttons (the font picker), not a
  select; the check picks "Publisher" from it.
- `place`, 768: the EPUB 3's orchard image sat mid-screen once the reader's
  layout changed (#280), so "a screen that starts on an image" found none.
  The fixture (`make-ebook-fixtures.mjs`, `epub3.epub`) now breaks before the
  image and makes it a column tall, so it always starts a screen; the height
  is what does it in Firefox, which ignores column breaks.
- `place`, 768: the check waited for a save after its last turn, and missed
  the save when it had already landed. It now records every save from the
  open on and looks for the one that carries the screen left on (a save
  holds the screen's start, the range's first point).
- `direction`: in Firefox the book's font arrives just after the open and
  reflows the first screen; that relocates once more with the same first
  words and a later end. The key press counted that reflow as its turn. The
  check now waits for the place to settle first.
- `src/components/ui/tooltip.tsx`: Escape closes a keyboard tooltip first
  and keeps the press (SLN-390), which is right on the page but wrong while
  a dialog, menu, popover or the command palette is open: there one Escape
  now closes the tooltip and the layer together. A focus tooltip also shows
  only for focus that Tab or an arrow key moved, not for focus the app
  moves itself (a dialog's first control, or the button a closed dialog
  gives focus back to, which showed its tooltip after every Escape). The
  `dialogs` row keeps a single Escape. `docs/03_DESIGN_LANGUAGE.md`,
  Tooltips, says so.
- `reader-navigation-checks.mjs`: Contents renders its text a moment before
  it opens and takes the focus; the check pressed Escape in between in
  WebKit. It now waits for the panel to be open and focused.

## Completion Notes

- Full check on a fresh preview: 244 of 245 rows pass in headless Chromium,
  WebKit and Firefox.
- Still failing: Firefox, 1440, "a saved place reopens at the same first
  words". That is SLN-696 (two-page spreads reopen one page back), left for
  its own change.
- The Firefox relocate after an open keeps the screen's first words, so no
  reader change was needed for it.
- Escape sweep (scratch script, headless Chromium, WebKit and Firefox, at
  1440 and 390): the New menu, the shortcut sheet, the command palette and
  the reader's Contents, Settings and Go to, opened and closed with one
  Escape, at once and after Tab to a control with a tooltip. With the old
  tooltip (Chromium), every dialog failed after Tab to a tooltip control,
  and Settings at 1440 left its button's tooltip up after closing. Now: 70
  of 72. The two left are Contents at 1440, which is
  not modal there: Tab leaves it for the toolbar, and Escape from the
  toolbar never closed it, with or without a tooltip (as on main).
- Tests: `dialog-escape.test.ts` (no tooltip for focus the app moves; one
  Escape in a dialog), and the tooltip tests now press Tab before a focus.
- No migration and no new packages.

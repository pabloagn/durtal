# Task 0780: Note makes its mark on save, one mark per passage, one toolbar

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0635
**Blocks**: None

## Overview

The rest of SLN-682, from the e-book review of 13 Oct. Note on a selection
made an ochre highlight at once, so a note given up left a stray mark, and
its dialog never showed the passage. The same words could be marked again and
again. A marked passage's menu had smaller, bolder, greyer buttons than the
selection's toolbar, four of them with no tooltip, and Underline was offered
only once a highlight existed. A drag just past the last line selected the
next, unseen page, over a thousand characters. Now:

- Note opens "Add a note" with the passage above the text. The mark is made
  only by Save note (or Cmd/Ctrl+Enter). Cancel, or Escape with nothing
  written, leaves nothing; Escape with words written asks Keep editing,
  Discard or Save. The dialog for an existing mark's note shows its passage
  too.
- A second highlight, underline or note on the words of an existing mark
  changes that mark (its colour or style, or opens its note) instead of
  adding another; Underline keeps the mark's colour. A quote stays a quote
  and the reader says so.
- The selection toolbar offers Underline beside the colours (behind More on
  touch).
- An existing mark's menu uses the toolbar's buttons: 32px (44px on touch),
  the toolbar's text, and a tooltip on each; Close is an icon.
- In a paginated book a selection keeps only what is on the screen, on
  either side.

## Implementation Details

- `src/lib/reader/same-mark.ts`: `samePassage()` (one CFI range, or on a PDF
  one page with the same words in the same context) and `markOnPassage()`.
  The merge is in the app, so there is no migration; a database rule against
  repeats would need one.
- `annotation-controller.ts`: `createHighlight()` takes a `note`.
- `use-reader-annotations.tsx`: a captured selection with its reader
  generation (`capture()`); `create()` merges into the mark on the passage;
  `startNote()` opens a draft, and `saveDraft()` makes the mark with its note
  (or adds the note to the mark when one appeared meanwhile). `markingMore`
  carries Underline into More on touch.
- `note-dialog.tsx`: a `draft` mode on the app's draft dialog (unsaved-work
  question, Cancel, Save note) that keeps written words when the page hides;
  `passage` above the text in a box that scrolls when long.
- `selection-toolbar.tsx`: `MARK_ACTION`, the one button look, used by the
  toolbar and `highlight-menu.tsx`.
- `src/lib/reader/selection-edge.ts`: `rangeOnScreen()` keeps the run of
  selected characters whose boxes are on screen (found by halving, since the
  words read in order) and `keepSelectionOnScreen()` keeps the anchor where
  the drag began. The foliate engine applies it when a drag ends and after a
  selection made from the keys or touch handles settles, only in paginated
  reflowable books (scrolled books, fixed layouts and PDFs are left alone).

## Completion Notes

- Chromium, WebKit and Firefox at 1440:
  - Note then Escape: "Add a note" with the passage, no mark made.
  - Words written then Escape asks Keep editing, Discard or Save; Cmd/Ctrl+
    Enter saves; the stored mark carries the note.
  - The same words in sage: still one mark, now sage.
  - Underline on a fresh selection makes an underline.
  - The toolbar's and the mark menu's buttons all measure 32px, 16px text,
    weight 400, the same colour, each with a tooltip.
  - A drag from a word near the bottom of the right page to past the text's
    edge: on main it selected 1,050 to 1,239 characters, 23 to 26 of 26 to 28
    boxes off screen; now 128 to 132, none off screen.
- 390 and 320 (touch in Chromium and WebKit): Underline sits behind More; the
  note dialog fits; 0 alignment, design-audit and overflow findings. At 320
  the swatches are 32 to 34px wide by 44px tall, as on main (SLN-678).
- 0 alignment and design-audit findings on the note dialog and the mark menu
  at 1440 in all three engines.
- Tests: `action-selection-annotations.test.ts` (Note makes no mark until
  saved, Cancel leaves none, a repeat merges, Underline on a selection);
  `same-mark.test.ts`; `selection-edge.test.ts`.
- `reader-engine-check.mjs` 284 of 284; `page-weight.js` within budget (the reader 24 of 400 KB).
- Not done: a delete made within the 10-second Undo window before the tab
  closes reaches the server only when the reader next opens on that device
  (measured in all three engines; with the tab open it lands after the
  window). A closing page does not finish the replay's device check and
  IndexedDB work; sending it needs a change to the shared replay's claim
  rules.
- No migration and no new packages.

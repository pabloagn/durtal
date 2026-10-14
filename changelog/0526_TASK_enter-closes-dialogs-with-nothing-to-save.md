# Task 0526: Enter closes dialogs with nothing to save

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0520, 0525
**Blocks**: None

## Overview

SLN-634, part of SLN-629 (a keyboard-native app). It checks every dialog
kind in `docs/15_KEYBOARD.md` section 4 against the contract: Enter presses
the main action once (or nothing for a danger button), Shift+Enter makes a
new line, and Esc closes at once when nothing is unsaved and asks first
when something is. The inventory had found two kinds of gap. Viewers and
managers had no main button, so Enter did nothing in them. New Order closed
on Esc with a picked book.

## Implementation Details

- **`Dialog` takes `done`** (`src/components/ui/dialog.tsx`). It adds a Done
  primary button under the body, outside its scroll, that closes the
  dialog as Esc does. Enter with the focus on the dialog presses it.
- **Where Done is used:**
  - the Keyboard shortcuts sheet;
  - Manage media;
  - a harmonize Resolution record.
  
  The Collections picker's existing Done becomes its primary.
- **New Order** (`provenance/order-create-dialog.tsx`) tells the dialog
  about the work its fields do not show. A picked book, method or status
  now makes Esc, Close, Cancel and the backdrop ask first. Save in that
  question creates the order with what is set. A book the dialog opened
  with (from an acquisition target) does not count as unsaved.
- **Left as they are:**
  - Danger confirmations: Enter presses nothing, pending the owner's word.
  - The harmonize merge confirmation ("One record, fully connected"):
    Enter does not press Merge either.
  - Match again: its selected source filter is the primary, so Enter
    presses that filter again, which changes nothing.
- **Docs:** `docs/15_KEYBOARD.md` section 4 (the kinds, the rows, the gaps).

## Completion Notes

`src/__tests__/ui/enter-and-leaving.test.ts` adds one test: Enter closes a
dialog with nothing to save, through its Done.

Browser checks ran on a production build of a disposable preview. They
used headless Chromium, Firefox and WebKit at 1280 and 390px, with Esc sent
as key code 27, 390 of 390 passing. The 11 dialogs were Edit collection,
New collection, Edit series, Edit recommender, Edit person, Edit Work and
Edit film, Keyboard shortcuts, Collections, Manage media, and Delete
collection.
- **Forms:**
  - Esc closes at once when clean.
  - With typed work, Esc asks; Esc on the question keeps the text.
  - Close and the backdrop ask; Discard closes without saving.
  - Shift+Enter in a text box makes a new line.
  - Enter in a Description saves and closes, and so does Enter in a field.
    New collection then opens its Add books, as designed.
- **Viewers and pickers:** each shows Done as its primary, and Enter and
  Esc each close it.
- **Delete collection:** Enter deletes nothing, and Esc closes it.

New Order by keyboard only, in the same three browsers and widths (54 of
54 passing):
- Enter with no book picked stays on step 1.
- With a book, Esc asks first, and Esc on the question keeps the book.
- Enter moves through the steps, and on the last it creates the order.

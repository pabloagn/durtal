# Task 0491: Enter saves in every dialog, and leaving unsaved work asks

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0490
**Blocks**: None

## Overview

The rest of SLN-631, after task 0490 (Esc cancels, and asks first with
unsaved work):

- Plain Enter presses a dialog's main button from a text box and from the
  dialog itself, not only from a one-line field. Shift+Enter starts a new
  line.
- A held Enter presses once.
- A link, a Go or Add key, or the command palette that would leave unsaved
  work asks Save, Discard or Keep editing first.
- Add book offers Save from every step that holds a book.

## Implementation Details

- `src/lib/shortcuts/shortcuts.ts`:
  - `isDialogTextBox` is a text box in a dialog. `data-enter="ignore"` keeps
    a text box's own Enter where each line is an entry: "Other names, one
    per line" in the organization dialog, and an edition's "Table of
    contents" (review: Enter there had saved the edition with one chapter).
  - `isQuietInDialog` is focus in a dialog on nothing with an Enter of its
    own: the dialog itself (a dialog with no field starts there) or text.
  - `shortcutButton` from the dialog itself looks in that dialog only.
    Before, its walk started at the dialog's parent.
- `src/components/shortcuts/shortcuts-provider.tsx`:
  - Enter in those two places presses the main button, as Enter in a
    one-line field does. A Delete is never the main button.
  - An auto-repeated Enter is consumed: a held key never saves, submits or
    clicks twice. A text box on a page, a rich text field and the reader keep
    their own Enter.
  - The reader's text boxes are left as they were.
- `src/components/ui/unsaved-guard.ts`:
  - Every open draft (a dialog, a page, an editor) registers with one
    capture listener for link clicks.
  - A same-site link to another page asks the newest draft with unsaved
    work. Discard follows the link, and a draft under it may then ask too.
  - Links that open elsewhere pass: a new tab, a modified click, a
    download, another site. So do links that stay on the page (another tab
    of it) and Cancel links, which their own draft asks for.
  - `leavePage(go)` gives the same rule to a navigation without a link: the
    G and A menus and the command palette.
- `OpenWorkLink` (task 0495: "Open this work", "Open that book", "Open this
  film", "Add a version to it") drops its own "Discard and open" question
  for this one. What its form does not count as entered (a picked search
  result, a film's title alone) marks it `data-leave="free"`: it opens at
  once.
- Add book: Save on the question adds the book as it stands. That is Fast
  Track on the work's step, and "Add to catalogue" with what the steps hold
  on the edition, copies, categories and review steps; a copy with no
  location is not created. A new work needs its title and author first.
  The search and duplicate steps hold nothing to save.

## Completion Notes

- `src/__tests__/ui/enter-and-leaving.test.ts` covers the following:
  - Enter and Shift+Enter in a dialog's text box, and a text box kept for
    lines;
  - Edit collection's Description saving on Enter (SLN-629's reported case)
    and an edition's Table of contents keeping it, both rendered for real;
  - Enter on the dialog itself, and never on a Delete;
  - a held Enter in a dialog, and a text box on a page;
  - links that leave, links that stay, a new tab, a modified click;
  - a key or palette navigation;
  - a dialog's draft over a page's draft.
- The browser back button is not asked about: the History API gives no way
  to hold it. A reload or a closed tab asks the browser's own question.
- Rich text fields (reviews, notes) keep Enter for paragraphs; ⌘Enter saves
  there.

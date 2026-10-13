# Task 0490: Escape cancels everywhere, and asks first with unsaved work

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: SLN-634 (exhaustive keyboard acceptance)

## Overview

SLN-631, with Joris's note of 13 Oct: Esc on any menu, dialog, panel or
step-by-step flow cancels cleanly. When there is unsaved work, it first asks
**Save**, **Discard** or **Keep editing**. Save runs the form's own save, with
its checks. Esc on the question keeps editing, with the draft and the focus
as they were. Close, Cancel and a click on the backdrop ask the same way.
Nested layers close one at a time, innermost first.

## Implementation Details

One mechanism, shared by every surface:

- `src/lib/ui/draft-tracker.ts`: unsaved work read from the form itself.
  - It reads field values, switches, radios, sliders, a select's shown
    choice and the chips with Remove.
  - The state is noted at the person's first act in the form (a press, a
    key, a paste or a drop). Values a form loads by itself are not their
    work, and a change put back is no change.
  - Search and filter fields, open lists and menus, and anything marked
    `data-draft-ignore` do not count.
- `src/components/ui/unsaved-guard.ts`: `useUnsavedGuard`, the close rule.
  - With no unsaved work it closes at once.
  - Otherwise it asks. Save is the form's `onSave`, else its save button,
    the one ⌘Enter presses (`data-shortcut="save"`, else the main button).
    A Delete button is never a save.
  - Cancel buttons carry `data-dismiss`: with unsaved work their press asks
    first, and Discard then presses them for real.
- `src/components/ui/dialog.tsx`:
  - `draft` watches the dialog's fields; `dirty` is a form's own comparison;
    `onSave` sets the save.
  - Esc reaches the guard through the dialog's surface lease (`guard` in
    `surface-state.ts`), also inside the reading dialogs' shared lease.
  - `UnsavedChangesPrompt` is the question, its own layer: Save is the main
    button (Enter) when the form can save as it is, else Discard.
- `src/components/shared/escape-to-cancel.tsx`: `useEscapeToCancel` gives
  pages, panels and in-page editors the same rule.
  - Layers are kept in the order they opened; the last one takes Esc first.
    An editor among others (`within`) takes only the keys from inside it.
  - A dialog, a list or menu that took the key, and a page search field (its
    first Esc leaves the field) all come first.
  - Leaving the tab with unsaved work asks the browser's own question.
- `src/lib/ui/surface-state.ts`: `isFreeEscape` is the one test for an Esc
  nothing else took. It skips an input method's composition, modifiers and
  an open light-dismiss popover. `passEscapeThrough` lets an Esc typed in a
  rich text field (ProseMirror marks every Esc handled) reach its dialog.
  Before, Esc in a review or note editor closed nothing.

Wired in:

- Add book: Esc cancels from every step, including the duplicate panel of
  the request's screenshot. Unsaved work is what was typed or chosen since
  the start or the last search result picked. Save is Fast Track on the
  work's step and "Add to catalogue" on the review; elsewhere the question
  offers Discard and Keep editing.
- Add film, perfume and painting, and the publisher editor (new and edit):
  Esc goes back as Cancel does. The publisher editor's save button is now
  its ⌘Enter save.
- 56 editing dialogs take `draft`, their Cancel buttons `data-dismiss`. The
  shared form footers (reading dialogs, author form, edition form, work form)
  carry it too. Reorder families compares the order itself.
- Configure columns is a `Dialog` now, so Esc closes it. Before, it was a
  fixed overlay with no keyboard close.
- Page editors: perfume notes, your notes, an edition's publishers,
  acquisition targets.
- The order panel on Provenance: Esc closes the status list, then the delete
  question, then the panel.
- Inline confirmations: "Use this edition" in Identify, and a prepared fix in
  Harmonize.
- Esc handlers that acted without marking the key handled now mark it (one
  layer per Esc): the comment editor, a series position, a taxonomy rename,
  the mark card.

Left as they were:

- Confirmations, viewers and pickers close at once: nothing to lose.
- Manage media and Collections membership: their changes are saved as made.
- The reader's own keyboard handling and dialogs: untouched.

## Completion Notes

- `src/__tests__/ui/unsaved-changes.test.ts` covers the following:
  - a clean, a changed and a changed-back dialog;
  - a picker search;
  - Save, Discard and Keep editing;
  - Cancel, Close, and an Esc taken by an open list;
  - input method composition;
  - a dialog with no draft;
  - a form page, a page search field, a confirmation over a page, and a
    dialog over a page.
- Journeys in headless Chromium, Firefox and WebKit, on a disposable preview,
  cover Add book (clean, typed, Keep editing, Cancel, Discard, Save by Enter
  as Fast Track), New collection (clean, typed, Close, Save), Add film, Edit
  work with an open list, and Log a past read with a typed review.
- Enter-primary in every dialog (the rest of the ticket's first paragraph) is
  not part of this change.
- In-app link clicks away from a page with unsaved work are not stopped yet;
  a reload or a closed tab asks.

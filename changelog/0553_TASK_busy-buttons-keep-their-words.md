# Task 0553: Every busy button keeps its words

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0601
**Blocks**: None

## Overview

SLN-713, the leftovers of SLN-699 (0601). Task 0601 gave the shared `Button`
a `busy` state that keeps the label and width, and moved the buttons that
said "Saving..." to it. It listed the plain buttons it left: Harmonize's
Scan, Apply and Confirm merge, the pickers' "Create …" rows, and the eBook
review dialogs' Confirming and Undoing buttons. A search for every busy
button found more of the same kind, in three shapes:

- a busy word in place of the label ("Save Changes" became "Saving",
  "Confirm decision" became "Confirming…");
- a spinner in place of the label (a location's Save, Delete and Create);
- a spinner added beside the label, which widens the button by its width and
  gap (the film, perfume and painting forms' Save, Link, Look up, Fast Track
  and others: 26 in all).

## Implementation Details

- **Shared `Button`s take `busy`**: the label stays; a leading icon turns into
  the spinner; a button with no icon gains none; it is disabled and carries
  `aria-busy`. Their own `disabled` keeps only its other conditions.
  - Label swaps: the book, person and order Save changes, Add person, Create
    venue, Create order, Merge people, a copy's Create instance, the order's
    Mark as, monochrome Apply, Choose a CSV file.
  - Spinner in place of the label: a location's Save and Delete, Create
    location.
  - Spinner beside the label: 26 buttons in the film, perfume, painting,
    organization, image, relation, wanted, institution, cover and add-book
    dialogs and the delete confirmation.
  - Icon swaps that already kept their width now use `busy` too, for
    `aria-busy`: Look up (postal code), Search (map, match again), Delete
    selected, Add to catalogue, Download.
- **Plain buttons** keep their words and carry `aria-busy`: the pickers'
  Create rows, a copy status's Confirm, the media URL's Add, the timeline's
  Show more (its chevron turns into the spinner).
- **Harmonize**: Scan library keeps its words and its icon turns into a
  spinner while it scans; other actions only disable it, where it said
  "Working…". Apply and Confirm merge keep their words. "Apply 1 fixes" reads
  "Apply 1 fix".
- **The eBook review dialogs**: Confirm, Undo, Unlink and Undo keep
  their words while they run. A retry keeps "Retry…" or "Try again" while it
  runs, through a `retrying` flag set when the write starts (in the decision
  state for `review-confirm`). Preview accessioned status and Check what
  changes stay in place, busy, where a separate "Preparing…" or "Checking…"
  button replaced them. Load next 50 and Unlink… keep their words.
- **Sentence case** on the labels touched: "Save changes", "Create venue",
  "Create order".
- Not changed: the reader's own controls; status lines that say "Saving"
  (they are not buttons); the "Keeping as an eBook…" step after an unlink,
  which stands for a second write rather than a pressed button; the linked
  book menu's "Loading link…" item.

## Completion Notes

- `src/__tests__/ui/button-busy.test.ts` gains a source check: no button
  outside the reader swaps its label for a busy word or a spinner, or adds a
  spinner beside it. On main it lists 44 places; it lists none now.
- `review-decisions` and `unlink-ebook-dialog` tests find the busy button by
  its label and check `aria-busy`.
- Measured in the browser: see the PR.

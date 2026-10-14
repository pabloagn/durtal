# Task 0601: Busy buttons keep their width

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-699, piece C of the SLN-641 slice 3 audit. A busy button swapped its
label for a busy word: "Save changes" became "Saving...", 40px narrower, and
Cancel moved 40px; the copy dialog's "Save" grew 25px. Only a few busy
buttons set `aria-busy`, and busy words were spelled with three dots (20) and
with the ellipsis (31). The edition dialog left its fields open while it
saved.

## Implementation Details

- **`Button busy`** (`src/components/ui/button.tsx`), as contract section 8
  says: the button keeps its label and width; a leading icon (any element
  child other than a plain tag) turns into a `LoaderCircle` spinner with the
  icon's own classes, as Export already did; a button with no icon gains no
  spinner. It is `disabled` and carries `aria-busy="true"`. A caller's own
  `disabled` still applies when it is not busy.
- **Adopted** by every `Button` that swapped its label for a busy word:
  - the 12 "Saving" buttons: reading dialogs' Save, the edition form (Save
    changes, Add edition), the copy's Edit, a book's taxonomy, series,
    recommender, collection, publisher, family edit, taxonomy order, the
    match preview (which had its own spinner and "Saving...") and the eBook
    differences' Confirm;
  - and the others: copy and book Delete, order Delete, collection Delete
    and Create, Add books (collections and series), series Link, taxonomy
    Create, Create family, Merge, Delete family and Delete item, Find page
    count, Import.
- **The edition dialog's fields** sit in a `fieldset` disabled while it
  saves, as the copy dialog's are, so nothing typed during a save is lost.
- **One ellipsis**: every busy or loading word is written with "…" (31
  places, including "Loading timeline…", "Searching ISBNdb…"). A test keeps
  three dots out of busy words.

## Completion Notes

- `src/__tests__/ui/button-busy.test.ts`: label and classes unchanged when
  busy, spinner in the icon's place with its size, none without an icon,
  `aria-busy` and `disabled`; and the ellipsis rule.
- Measured in the browser: see the PR.
- Not changed, listed for later: the reader history recovery's "Saving…"
  (settings, eBook reader history; left to the eBook thread), and busy labels
  on plain `<button>` elements that are not the shared `Button` (Harmonize's
  Scan, Apply and Confirm merge; the pickers' "Create …" rows); the eBook
  review dialogs' Confirming and Undoing buttons.

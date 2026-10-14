# Task 0584: "Change the book…" on an eBook's linked book

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0504, 0516
**Blocks**: None

## Overview

SLN-666 leftover from 0504 ("Not covered"): to move an eBook to another
book you had to unlink it, find it again and choose the book. The linked
book card's menu now has "Change the book…".

## Implementation Details

It joins the two decisions that already exist, each with its own check and
receipt, rather than adding a relink service:
- **The unlink dialog** (`unlink-ebook-dialog.tsx`) takes `change`. It is
  titled "Change the book of “…”", says the eBook is taken off its book and
  then you choose its new one, and starts on a new "Choose its new book"
  option. "Return it to review" and "Keep it as an eBook" stay offered. The
  button reads "Unlink and choose". The preview is the unlink's own, with
  "Then you choose its new book." as its last line.
- **After the unlink** the dialog marks the eBook (`choose-book-next.ts`,
  read once) and closes. The eBook's controls (`ebook-link-controls.tsx`)
  open "Choose a book" for it as soon as it shows as unlinked.
- **If you stop at the chooser**, the eBook waits in review, as after a
  plain unlink. A reload does not reopen the chooser.
- `linked-book-menu.tsx` adds the item (Lucide `Replace`) above "Unlink
  from this book…". `useUnlinkEbook.open` and the layout's dialog host pass
  `change` through; a plain Unlink is unchanged.

## Completion Notes

- Tests: `unlink-ebook-dialog` (the change flow marks the eBook and closes;
  "Choose its new book" is offered only through "Change the book…").
- On a disposable preview, headless Chromium: link an eBook through "Choose
  a book", then "Change the book…", "Check what changes", "Unlink and
  choose". "Choose a book" opened by itself, and confirming another book
  put it on the card. Pressing Escape at the chooser left the eBook in
  review with its "Choose a book…" controls.
- The alignment, design, overflow and touch audits are clean on the eBook
  page, with the menu open, and with the dialog before and after "Check what
  changes": Chromium at 1440, 768, 390 and 320, Firefox and WebKit at 1440
  and 390 (32 renders). Page weight passes (eBook page 65 of 200 KB).
- As in 0504, the preview's seeded links have no receipt, so the dialog
  does not open on them ("The decision could not be verified"). Real links
  carry one.
- No migration and no new packages.

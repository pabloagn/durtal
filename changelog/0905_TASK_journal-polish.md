# Task 0905: Journal and review polish: long words wrap, focus stays on the row, "Show review" only when it hides something, wording and Title order

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1072, SLN-1074 and SLN-1075, from findings 2, 4 to 9 of
`findings/journal-survey-2026-10-16.md`.

SLN-1073 needs no change. The coordinator decided that the 300 KB budget
covers the default page size of 48 only. Page weight passes the journal
(258 KB) and `/library` (263 KB) at that size.

## Implementation Details

- **Long words** (SLN-1072): `type-prose` breaks an unbroken word or URL at
  the column's edge (`overflow-wrap: break-word`). Normal words stay whole.
  This covers reviews, book descriptions, bios, and collection and series
  descriptions.
- **Focus after Edit or Delete** (SLN-1074):
  - **The cause.** `ReadingDialogsProvider` restored the focus in a
    microtask, while the modal dialog was still in the page. Everything under
    it was inert, so the row's menu button refused the focus and it fell to
    the body.
  - **The fix.** The provider now restores the focus once the dialog is gone,
    in a layout effect. After Save, the focus is back on the row's menu
    button.
  - **After Delete.** The journal's rows join the app's `FocusKeeper`
    (`data-focus-list="journal"`, `data-focus-row`). The focus moves to the
    same control of the row that took the deleted one's place, else the row
    before it, else the page's heading.
  - **A deviation.** The ticket asked for the next row's title link. The app's
    convention, for every list, is the same control in the next row, so that
    is the menu button here.
- **"Show review"** (SLN-1074, `Review` in `reading-section.tsx`):
  - The toggle shows only when the three-line clamp hides some of the review.
    It is measured after layout, and again when the width changes.
  - It has `aria-expanded` and `aria-controls`, and `touch-hit`.
- **Wording and order** (SLN-1075):
  - Delete reading says "This deletes the reading and its history." when it
    has no sessions.
  - Under Title sort, a book's readings stay together in the order they were
    read (`w.id`, then the reading's ordinal, in the sort's direction).
  - A journal row's first author links to their page, the dot kept with the
    name.
  - Item 2 of the ticket ("Finished" twice) moved to SLN-1098.

## Completion Notes

- **Long words.** Checked on a private preview, with a review of about 5,000
  characters, a 240-letter word and a long URL, and a description and a bio
  with a long URL. In Chromium, Firefox and WebKit at 1440, 390 and 320, no
  `type-prose` block is wider than its column, and nothing scrolls sideways.
- **Focus.** Edit, Save and Delete on journal rows, in all three browsers:
  - After Save, the focus is on that row's menu button. On main it was on
    the body in Chromium.
  - After Delete, the focus is on the next row's menu button by 300 ms. In
    Firefox and WebKit it is on the body for a frame, until the row's removal
    is seen.
- **"Show review"**:
  - A one-word review has no toggle. A long one has one, with
    `aria-expanded="false"`, and its `aria-controls` names the review.
  - A press opens the review in full, sets `aria-expanded="true"` and keeps
    the focus on the toggle.
- **Delete wording.** On a reading with no sessions, the dialog reads "This
  deletes the reading and its history."
- **Audits.** The browser audit passes 36 of 36 loads, covering alignment,
  design, overflow and touch at 390 and 320. It ran on the book page, a
  person page, the journal and the journal by title, in three browsers at
  1440, 390 and 320. Page weight passes every route.
- **Tests**:
  - `integration/reading-hub`: under Title sort, a book's readings come in
    the order read, reversed under Z to A, with the author's page.
  - `ui/journal-separators`: the author links to their page, the dot stays
    with the name, and the row is a focus row.
  - `pnpm typecheck` and lint are clean. Lint has four warnings, all from
    before this change.

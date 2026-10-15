# Task 0623: The Highlights panel reads as passages

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Finding 4 of the reader audit (SLN-726). The reader's Highlights and notes
panel was busy:
- Every row carried four buttons (Go to mark, Show full text, Edit and a
  red-filled Delete), so the list read as buttons, not passages.
- The tabs wrapped onto two lines at every width.
- A book with no marks said "No highlights match." and still offered three
  export buttons.
- The filters were native selects, and dates were written 10/15/2026 here
  but 2026-10-15 on the highlights page.
- "All highlights" was a 24px touch target.

## Implementation Details

- `src/components/reader/annotations-panel.tsx`
  - `MarkRow`: the passage, its note and its place make one button that goes
    to the mark. It is named by the passage and described by the note and
    place. A mark that could not be placed is plain text.
  - One quiet menu beside each passage ("Highlight actions", cap-aligned on
    its first line) holds the rest: the full passage when it is long, Add a
    note or Edit note, the colour (as radio items with their swatch), and
    Delete.
  - Tabs read Highlights, Notes and Bookmarks on one line. The count moves
    into the filter field ("Find in 406 highlights").
  - The filter field and the selects show only when the tab has marks. The
    colour filter (the app's `Select`) is for highlights and notes, not
    bookmarks.
  - Empty tabs say how to make the first one ("No highlights yet. Select
    text in the book to highlight it."); "No highlights match." is kept for
    a filter that finds nothing.
  - The day is written as on /ebooks/highlights (2026-10-15).
  - "All highlights" is a `text-command` link: 44px tall on touch.
- `src/components/reader/annotation-export-controls.tsx`: the three export
  buttons become one Export menu (Markdown file, Web Annotation file, Copy
  as Markdown). It shows only when the book has marks.
- `src/components/ui/dropdown-menu.tsx`: Escape inside an open menu closes
  the menu only. The reader's side panels close on any Escape inside them,
  so one Escape on a row's menu closed the menu and the panel together, with
  focus lost to the page. The menu now stops the Escape it handles (docs/03:
  one layer per press).
- `src/components/ui/segmented-control.tsx`: an opt-in `fill` prop lays the
  choices out in equal columns with tighter padding. The tabs use it, so
  they keep to one line in a 320px panel on touch; no other caller changes.
- `scripts/qa/reader-engine-check.mjs`: the pdfmarks row clicks the passage
  (`data-annotation-go`) instead of a "Go to mark" button.

## Completion Notes

- Panel audits in Chromium, WebKit and Firefox at 1440, 390 and 320 (touch
  at 390 and 320 in Chromium and WebKit), on a book with 406 highlights and
  on a book with none: the panel, a row's menu and the end of the list. 0
  alignment deviations, 0 low-contrast or unnamed controls, 0 overflow, 0
  touch targets under 44px. The tabs keep to one line everywhere. One
  Escape closes a row's menu and leaves the panel open, focus on the menu's
  button.
- Tests:
  - `annotations-panel.test.ts`: the empty book, the passage button with its
    one menu and its date, and the unplaced mark.
  - `dropdown-menu.test.ts`: Escape in a menu inside a panel that closes on
    Escape closes only the menu, and the next Escape is the panel's.
- No migration and no new packages.

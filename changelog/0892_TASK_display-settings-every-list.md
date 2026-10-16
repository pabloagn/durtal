# Task 0892: Display settings list every list, and say what they do

**Status**: Completed
**Created**: 2026-10-16
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-925, from finding 5 of `findings/settings-survey-2026-10-16.md`.
Settings > Display had four problems:

- Its Lists table left out Films, Perfumes, Paintings and a publisher's
  books, though each saves its own view and grid size, and Reset clears them.
- The Collapsed sidebar switch did nothing on a phone, where the sidebar is
  a drawer.
- Reset's confirm did not say that it also clears the sort of Books and the
  "I'm at" place in Up next.
- "6 per row" draws 5 when a card would fall under its 208px readable width.

## Implementation Details

- **`LIST_PREFERENCES`** (`src/lib/preferences.ts`) gains `films`,
  `perfumes`, `paintings` and `publisherBooks`, with the keys those lists
  already used. The lists now read their keys from there, so the table and
  the list can't drift apart:
  - `useHomeView` (`domain-home-shell.tsx`) for the three other kinds of
    work;
  - `publisher-books.tsx` for a publisher's books.
- **Page size.** A publisher's books keep a page size per publisher, so the
  table shows a dash there (`perPage: false`).
- **The sidebar group** is hidden below `md`, where the sidebar is a drawer.
  `SettingsGroup` takes a `className` for that.
- **Reset's confirm** names the sort of Books, the sidebar width and the
  "I'm at" place in Up next. Its description adds the sort.
- **Grid sizes** read "Up to 6 per row". The longer label needs room:
  - the table's grid column is 10rem at its widest;
  - narrower, the controls sit two a row;
  - below a 400px table they sit one a row, so no label is cut. Main
    already stacked them below 22rem (Task 0755); the longer label moves that
    point to 400px.

## Completion Notes

- **Unit test** (`ui/display-settings.test.ts`):
  - the four lists have their controls, and a publisher's books has no page
    size;
  - choosing List for Films is the view `useHomeView("film")` shows;
  - every grid option reads "Up to N";
  - the sidebar group is hidden below `md`;
  - Reset's confirm names the sort, the sidebar and "I'm at".
- **In the browser** (Chromium):
  - a view, grid size and page size chosen in Settings show on `/films`,
    `/perfumes` and `/paintings`: List, three a row, and `?perPage=96`.
- **Three browsers at 1440, 1024, 768, 390 and 320:**
  - all twelve lists show;
  - no grid label is cut;
  - the sidebar switch shows from 768 up and not on phones (in headless
    WebKit on Linux a 6px scrollbar leaves 762px at 768, so the switch hides
    there, as the sidebar itself becomes a drawer);
  - no page scrolls sideways.
- **Audits.**
  - After rebasing on main, the browser audit passes 36 of 36 loads of
    `/settings/display`, `/films` and `/publishers/gallimard`, at 1440,
    1024, 390 and 320. The alignment and layout audits report nothing on
    those pages at 1440, 1024, 768, 390 and 320 in three browsers.
  - Page weight passes on every route; `/films` is 251 of 300 KB.

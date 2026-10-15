# Task 0625: Search in book: switches, a Search button, and a results bar clear of the text

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Finding 5 of the reader audit (SLN-727). In Search in book:
- the options (Whole words, Match case, Match accents) were native
  checkboxes;
- "Search" was a bare blue text link under the field;
- after the panel closed, the results bar ("1 of 217") floated over a line
  of the book's text, in every browser at 1440, 390 and 320.

## Implementation Details

- `src/components/reader/search-panel.tsx`
  - The field is the app's `Input`, with its clear button as the field's
    suffix, beside a secondary Search button. Enter still searches, and
    Enter again goes to the next match. The suffix is always given, so the
    field is never remounted (and never loses focus) when the clear button
    comes and goes.
  - The options are `Switch` rows whose words toggle them too, as in Reading
    settings.
  - Stop, "Show 200 more" and the results bar's Results are ghost buttons.
  - The results bar is a full-width bar at the foot of the screen, in the
    bottom bar's place: below the text, in the margin the book already
    keeps for that bar, so it covers no line. It reports its height
    (`onDockHeight`).
- `src/app/reader/[ebookId]/reader-view.tsx`: while the results bar shows,
  the bottom bar stays hidden, and the speech player and the selection
  toolbar stand above the results bar instead of the bottom bar.

## Completion Notes

- Chromium, WebKit and Firefox at 1440, 390 and 320, in the EPUB fixture,
  with the bars shown and hidden: the results bar covers 0 lines of text.
  Before, it covered 2 or 3 lines in every case.
- Audits of the empty panel, the panel with 217 results and the results
  bar: 0 alignment deviations, 0 low-contrast or unnamed controls, 0
  overflow, 0 touch targets under 44px.
- Focus: closing Search on a phone (its Close, Escape, or after a search)
  returns to More, the control that opened it, in Chromium and WebKit; on
  a wide screen it returns to "Search in book". The slip seen once in the
  audit (focus on "Bookmark this page") did not reproduce, on main either.
- Scrolled books, PDFs and comics use the whole screen under bars that come
  and go; there the results bar stands where the bottom bar does and, like
  it, covers the foot of the page while it shows.
- `search-panel.test.ts`: one field while typing, three switches, a Search
  button, and the results bar's height while it shows and 0 after it ends.
- No migration and no new packages.

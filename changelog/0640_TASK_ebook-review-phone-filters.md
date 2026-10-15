# Task 0640: The e-book review queue starts on the first screen of a phone

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Main audit of 15 October (`/mnt/project-files/findings/audit-2026-10-15.md`,
finding 3; SLN-718). On a phone, the review page put four filter fields
(title or author, language, format, ISBN) and a full-width Apply filters
above the queue. The first item started at 914px, below a 390 x 812 screen.
Every other list page now shows its first card in the top 60% (0592).

## Implementation Details

- `ebooks/review/review-filters.tsx` (`ReviewFilters`, client): on a phone
  the search field shares its row with Filter, outlined like every other
  list's Filter and showing how many choices are set. Filter opens language,
  format, ISBN and Apply under the row (`aria-expanded`, `aria-controls`).
  From `sm` up both wrappers are `display: contents`, so every field is a
  cell of the form's grid, as before.
- `ebooks/review/page.tsx` passes the search field and the choices in. The
  form, its field names, its hidden filters and its URL are unchanged.
  With Apply hidden, a browser does not submit on Enter by itself, so Enter
  in the search field asks the form to submit (`requestSubmit`).
- `components/ebooks/review-section.tsx` (`ReviewSectionNav`): below `sm` the
  section chips are one row that scrolls inside itself, as the reading tabs
  do, instead of four wrapped rows. The open section is scrolled into view
  without moving the page.

## Completion Notes

- On a production preview at 390 x 812, the first item now starts at 576px
  (914px on main). At 320 it is at 626px in Chromium and Firefox and 650px in
  WebKit. From `sm` up nothing moves: 382px at 1440, as on main.
- In Chromium, Firefox and WebKit at 390 and 320:
  - Filter opens the choices;
  - choosing EPUB and pressing Apply filters loads `format=epub`, and Filter
    then shows 1;
  - Enter in the search field loads `q=`, also at 1440 and 768.
- With "Partially held" open, its chip is scrolled into view at the row's
  right edge, and the page itself stays at the top.
- Alignment, overflow, design and touch audits are clean on the review page
  and its "Partially held" section, in three browsers at 1440, 1024, 768,
  430, 390 and 320 (36 of 36).
- `page-weight.js`: the review page is 95 of 300 KB.
- Tests: `review-filters.test.ts` covers Filter, its count, Enter, and the
  section row's classes. The UI and e-book tests pass (206 files).
- No migration, no new package.
- Review fix (first reviewer): the phone Filter panel now closes on Escape,
  with focus back on Filter, and has Clear all when a choice is set (it
  unsets language, format and ISBN and keeps the search and the queue's own
  scope); on touch its fields sit 16px apart so Clear all and Apply keep
  separate press areas. An Enter that confirms an input method's
  composition no longer sends the search (`isComposing`). The section row
  brings the open chip into view from either side, in whole pixels, so it
  shows after Back. Tests in `review-filters.test.ts`.

# Task 0630: A PDF with no outline calls its pages pages

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Finding 9 of the reader audit (SLN-731). A PDF with no outline listed its
pages in Contents as "Section 1", "Section 2" and so on, under "This book has
no contents. Sections are listed in reading order."

## Implementation Details

- `src/lib/reader/engines/foliate/engine.ts`: a PDF's or a comic's sections
  are its pages, so they are named "Page 1", "Page 2"; the book info says so
  with `pagedSections`. Every place that falls back to a section's name (the
  Contents list, the chapter in the bottom bar and its quiet band, search
  hits) now says the page. Beside "Page 3 of 4" the bar says the place once,
  as it already does for a comic. Each page takes the book's own label, as
  the bar names it: a PDF with Roman front matter lists "p. i", "p. ii",
  "p. iii", then "Page 1", so picking one lands on the page the bar then
  names (review of #346).
- `src/lib/reader/engine.ts`: the optional `pagedSections` field on
  `BookInfo`.
- `src/components/reader/contents-panel.tsx`: for such a book the note reads
  "This book has no contents. Its pages are listed in order."

## Completion Notes

- Text PDF fixture in headless Chromium, WebKit and Firefox at 1440 and 390:
  no visible text, label or tooltip says "section" on open, in Contents, in
  the quiet band or in search; Contents lists "Page 1" to "Page 4". Before,
  Contents listed "Section 1" to "Section 4". The comic fixture, which has
  its own contents, is unchanged.
- 0 alignment and design-audit findings on the reader and in Contents at
  1440, 390 and 320; `page-weight.js` within budget.
- Tests: `navigation-ui.test.ts` renders Contents for an outline-less PDF;
  `foliate-bridge.test.ts` names a labelled paged book's sections "p. i",
  "p. ii", "Page 1".
- No migration and no new packages.

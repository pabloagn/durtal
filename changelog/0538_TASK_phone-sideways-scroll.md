# Task 0538: Three pages no longer scroll sideways on a phone

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

From the design audit, SLN-641 slice 2, P1 "Three pages scroll sideways on a
phone" (`/mnt/project-files/design-audit/sln-641-slice-2.md`).

## Implementation Details

- Reading import preview: the commit button's label ("Import 6 readings and
  1 note, and add 1 book to Up Next") grows with the import's counts and
  never wrapped, so it was 432px wide on a 390px phone. The button
  (`CommitImport`, `src/components/reading/import/import-client.tsx`) now
  wraps its label inside itself, at most the row's width, at least 32px tall
  (44px on touch). Other buttons keep the shared rule that a label never
  wraps.
- E-book run page: the header's description is the run's place and folder,
  one unbroken path. `PageHeader`'s description now breaks a word that does
  not fit (`overflow-wrap: anywhere`), as its title already does. Text that
  fits is unchanged; only a word wider than the row breaks.
- Up Next (`src/components/reading/queue-list.tsx`): on a 320px phone with
  touch, "Start reading" and the row's menu (149px) did not fit the 122px
  title column and ran past the screen. When the list is narrower than 20rem
  the controls start under the cover instead, spanning the cover's and the
  title's columns, and the label lines up with the cover's edge. Wider lists
  are unchanged.
- Reading import preview, again: the section title is the uploaded file's
  name ("goodreads_library_export.csv"), one 30px word wider than a 320px
  phone. `SectionHeading` now breaks a word wider than its row, like
  `PageHeader`'s title.

## Completion Notes

Measured on a disposable preview against main in Chromium (1440, 1024,
390 and 320 with touch), Firefox (1440 and 390) and WebKit (1440, 390 and
320 with touch):

| Page | Main, widest point | Now |
|---|---|---|
| Import preview | 432px on a 390 and 320 screen (413 in Firefox and WebKit) | the screen's width; the button wraps to 52px tall |
| E-book run | 344px on a 320 screen (347 in WebKit) | the screen's width |
| Up Next | 322px on a 320 screen | the screen's width; Start's label at the cover's edge |

- Overflow, alignment, design and touch audits: no issue on the three
  pages (main: the overflow and its offenders above).
- The `PageHeader` and `SectionHeading` change: 45 routes at 1440 and 390
  measure the same as main except the import preview (a build of main
  without #259 differed on /harmonize only by that PR's headings).
- Page weight: 44 of 44 routes within budget.

Review fix: with the heading's `overflow-wrap: anywhere`, "Institution" on a
place page broke as "Institutio / n" at 320, squeezed to 104px by "Link an
institution". `SectionHeading`'s row now wraps: the title column is `w-min
min-w-0 grow`, so its narrowest width is its longest word, and when that word
and the action do not fit side by side the action goes under the title at
the right (`ml-auto`). The heading uses `break-word`, so a file name wider
than the screen still breaks. Pinned by `section-heading-wrap`; the reviewer
measured every heading on 38 routes in three browsers against main.

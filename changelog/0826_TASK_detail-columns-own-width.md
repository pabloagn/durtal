# Task 0826: Detail pages pick their columns from their own width

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-889, from the mid-width survey (findings/mid-width-survey-2026-10-16.md,
item 1). A detail page put its record column beside the reading column from
a 1024px screen, ignoring the sidebar. At 1024 with the sidebar open the page
is 752px, so the reading column was 416px: a person's books one a row, a
book's edition card stacked, narrower than the same tablet in portrait.

## Implementation Details

- `DetailColumns` (`src/components/shared/detail-layout.tsx`) is a container,
  and the two columns start where the page itself is 56rem (896px) wide
  (`@4xl:`), instead of at the `lg` screen width.
- Every detail page and its loading screen use `DetailColumns`, so all of
  them change together.

## Completion Notes

- Measured on a book, a person, a film, a painting, a publisher, an
  organization and an e-book in Chromium, Firefox and WebKit, with the sidebar
  open and as a rail:

  | Screen | 768 | 1024 | 1180 | 1280 | 1440 |
  |---|---|---|---|---|---|
  | Sidebar open: page, reading column | 664, one column | 752, one column (was 416 beside the record) | 908, 572 | 1008, 672 | 1104, 768 |
  | Sidebar as a rail | 664, one column | 920, 584 | 1076, 740 | 1104, 768 | 1104, 768 |

- A person's books at 1024 with the sidebar open are two a row at 240px
  (one a row at 416px before).
- The alignment, design, overflow, layout and touch audits are clean on those
  pages at 1440, 1180, 1024, 768 and 390; page weight passes.
- The painting page's picture-and-facts header still splits at the `lg`
  screen width; it was not part of the finding.

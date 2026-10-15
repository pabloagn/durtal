# Task 0694: Suggestions stay under their page budget with a large library

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-809, from the #370 review (`findings/review-pr-370.md`, notes): with a
library of about 800 books, `/reading/suggestions` was 307 KB against its
300 KB budget. Joris's library is that size. The suggestion list took 171 KB
of the HTML, and about half of each row was its "Why this?" popover: every
feature's bar, reason and evidence links, hidden until the button opens it.

## Implementation Details

- `src/components/reading/suggestions/why-this.tsx`: the popover's content
  renders the first time it opens (on `beforetoggle`, or on `toggle` where
  a browser lacks it), synchronously, so it is placed at its real height. The
  button and the empty popover stay in the page; the row's data was already
  in the page's data for the client.

## Completion Notes

Production build, local preview with the synthetic catalogue, the demo books,
the reading journey and the #370 review's library seed
(`findings/review-370-reading-seed.py`, 806 books):

- `/reading/suggestions`: 307 KB before, 240 KB after (`page-weight.js`).
- Why this? in headless Chromium, Firefox and WebKit at 1440 and 390 (touch):
  the first, sixth and last rows' popovers open with their parts, sit inside
  the 16px gutter at their real height, and close on Escape. No console
  errors.
- Browser audit 9 of 9 (1440, 390, 320).

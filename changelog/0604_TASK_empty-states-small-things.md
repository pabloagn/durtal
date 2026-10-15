# Task 0604: Empty states, small things

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-702, piece F of the SLN-641 slice 3 audit. Two add buttons were in
title case where the app's labels are in sentence case. The eBook runs page said
it had no runs in one grey sentence, where every other list draws an empty
state. The audit also reported a 1px alignment deviation on
`/organizations` at 390 and 320 in Chromium, Firefox and WebKit.

## Implementation Details

- **Sentence case**: the series page's "Add Series" button and the
  recommenders page's "Add Recommender" button become "Add series" and "Add
  recommender".
- **`/ebooks/runs` with no runs** draws the shared `EmptyState`: a history
  icon, "No runs yet", and what the page lists (each apply, upload batch and
  verification) and where applies come from (the ingest command, run on the
  machine that holds the files).
- **The `/organizations` deviation was the audit's**, not the page's. The
  first row's name starts at 16px, and so does the page count above it
  ("1–48 of 81"). The audit measured the count's first word instead, a
  "Showing " that only screen readers get on a phone (`max-sm:sr-only`, a
  clipped 1px box pulled 1px out by its margin). `scripts/qa/alignment-audit.js`
  now skips text inside such a box when it looks for the text a control
  lines up with.

## Completion Notes

- Measured on a production build: see the PR.

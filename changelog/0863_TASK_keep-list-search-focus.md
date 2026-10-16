# Task 0863: Keep focus when clearing list searches

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-883: list searches clear on the first Escape while retaining focus; another Escape on an empty field moves to Filter or the page heading. No-results Clear search focuses an empty field before navigating, and filter-group searches announce no matches.

## Implementation Details

- A shared clear request reaches the owner of each list-search draft. EntityFilters, organizations, eBooks and taxonomy cancel pending debounce work; their existing filters and navigation semantics stay in place.
- Clear links request a draft-only clear, so their own destination cannot be overwritten by a delayed search. In-place clear callbacks and modified link clicks retain their behavior.
- The keyboard path recognizes marked list searches, preserves composition and open-surface ownership, and consumes repeats without performing the second Escape action.
- Regression fixtures cover standard/controlled list fields, pending searches, focus restoration, composition, the two Escape steps and empty filter results. Existing picker Escape behavior remains separate.
- Update the existing keyboard and route descriptions to match this behavior.

## Completion Notes

Source prepared after SLN-921 in the isolated worktree from remote main `bdc1f24d`. No tests, typecheck, builds or browser checks have run yet. Acceptance requires the affected lists in Chromium, Firefox and WebKit at 1440/390 px, plus alignment/design and page-weight checks after the shared local slot is granted. No live catalogue writes or deployment.

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


### Grant 14 validation

At frozen UI source head `0b30f31cb5be2402c96fa594695f524121f62fb2`, the affected UI checks passed **82/82 tests** across 12 files, **0 failures and 0 skips**, in 8.56 seconds using Node 22.23.3 and one Vitest worker. Full `pnpm typecheck` then exited **0**. Reports: `/private/tmp/sln921-883-grant14-ui.json`, `/private/tmp/sln921-883-grant14-ui.log` and `/private/tmp/sln921-883-grant14-typecheck.log`.

The reviewed CI health repair `2e8738e6612407b7b6f775e99f9422a3a30a3765` merged without conflicts as `1e966c97d9dd12605fb377a0cef11b8d743854ae`. It changes only QA tests and their changelogs; the validated application source is unchanged. No build, browser, alignment or page-weight audit ran in grant 14. Those acceptance checks and full final-head hosted CI remain pending. The branch has not been pushed.

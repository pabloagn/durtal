# Task 0540: The interaction audit opens closed details

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-552. `scripts/qa/interaction-audit.mjs` never opened a `details` element, so the controls folded inside one (a painting's location history, the fields a merge fills on /harmonize) were never checked from the keyboard or on touch. On main the audit also failed twice on /harmonize: "Dismiss finding" and "All N record types" were 19px tall on a phone.

## Implementation Details

- `scripts/qa/interaction-audit.mjs`: a page with a closed `details` (at 1440px or at 390px) runs every check a second time with each one opened by Enter on its summary, nested ones after their parent. Results of that pass say "(details open)"; a failure the first pass already reported is not repeated. A summary that Enter does not open fails. /harmonize joins the default routes.
- `src/app/(catalogue)/harmonize/harmonize.css`: on a coarse pointer, `.h-text-button` and `.h-record-link` get a real 44px box instead of a pseudo-element press area that overlapped the controls beside them, and the "missing fields will be filled" summary is 44px tall. The desktop is unchanged.
- `docs/03_DESIGN_LANGUAGE.md`: the audit's line says what the second pass does.

## Completion Notes

- The "1 digital copy" failure on the film page that the ticket lists no longer reproduces on main.
- The parked draft #192 was not revived: it rewrote the audit across five new modules (about 2,000 lines). This keeps the audit in one file.
- With a disposable painting given four history records (so its history folds), the second pass walks 57 tab stops instead of 47 and opens 19 dialogs instead of 9.

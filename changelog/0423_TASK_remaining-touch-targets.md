# Task 0423: Remaining touch targets

**Status**: Completed
**Created**: 2026-10-09
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Resolve the remaining SLN-550 touch targets on the three creation forms and taxonomy pages without changing mouse controls.

## Implementation Details

- Audited the five reported routes before editing: Add and Unknown already meet 44px in all three engines. The remaining initial failures were taxonomy colour triggers, drag handles, picker choices, and item breadcrumbs.
- Taxonomy controls now reserve distinct 44px boxes on coarse pointers, including hierarchy toggles and short row links. The colour palette fits inside the viewport, stops row-selection bubbling, and restores trigger focus when choosing a colour or closing with Escape. Escape keeps a parent dialog open.
- Breadcrumb links have coarse 44px boxes and wrap with the current item. Long unbroken item titles remain readable inside the viewport.
- Opening Unknown credits exposed small role, remove and credited-name controls. These now grow on touch; credit labels and controls wrap to remain readable without collisions. The shared chip remove button opts in only for the affected perfume/painting credit rows; other chip callers keep their existing layout.

## Completion Notes

Validation uses headless Chromium, Firefox and WebKit, actual loaded fonts, synthetic short/long/nested and absent-colour data, narrow and desktop widths, open picker/dialog callers, edge hit testing, keyboard focus and colour persistence on a disposable database. Local QA artifacts are kept outside the repository. The unrelated New family form's existing scope/hierarchy checkbox labels remain outside this ticket; its changed colour picker is checked separately.

Required gates are typecheck, lint, the complete local suite including Python and database tests, production and Docker builds, and page-weight checks. Final-head gate results are recorded in the pull request and local evidence checkpoint before merge authorization.

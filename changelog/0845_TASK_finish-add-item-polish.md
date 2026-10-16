# Task 0845: Finish Add-item notices and keyboard polish

**Status**: Completed
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-948, SLN-952
**Blocks**: None

## Overview

Advise about same-name records without blocking intentional additions, and complete the remaining Add-flow keyboard and presentation acceptance items.

## Implementation Details

- Add small exact-name lookups, normalized for accents and case, and advisory notices for perfume, painting, publisher, person, organization, series and collection. Preserve the existing richer film notice.
- Keep stale name lookups out of current results and leave Save available.
- Use cover-letter fallbacks for wizard matches/results, identify ISBN matches correctly and show the duplicate step in its actual position.
- One Escape exits a clean, idle book search; open results still close first. Draft-loss prompts start on Keep editing.
- Add organizations to A O, the N menu, shortcut help and palette via the shared registry.
- Use the existing checkbox treatment, sentence-case date labels, consistent Add collection wording, and explicit missing-name hints.

## Completion Notes

Validated with 987 tests across 171 suites using the disposable-database harness (no skipped Vitest tests). Reused the already-passed, byte-identical Python preflight. Production build, typecheck and lint pass; lint retains 80 pre-existing warnings. All eight item kinds were exercised in Chromium, Firefox and WebKit; advisory notices, intentional duplicate creation, one-Escape search exit, safe draft cancellation, cover letters and organization shortcuts pass. Fifty-four empty-form width checks and eighteen keyboard checks pass. Page-weight passes 37 available routes, with eight unseeded routes explicitly skipped. No deployment or live catalogue writes.

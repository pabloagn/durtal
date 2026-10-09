# Task 0424: Audit the controls revealed by closed details

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-552. The interaction audit skips folded controls, but never opens their
summaries to check them. Reloads before menu and dialog checks close details
again. The film collection link already has its earlier padding fix, and
Harmonize's text buttons already have centered 44px pseudo-element targets;
no product UI change is included.

## Implementation Details

- Walk actual summaries through Tab and Enter, discover newly inserted and
  nested details while their ancestors remain open, and report nonempty
  revealed-control counts. Restore original disclosure, focus and scroll
  state in finally, including after failed inspections.
- Compare visible native keyboard candidates with actual Tab stops. Check
  menus through Enter/Space and arrow keys; compare focus return by element
  identity, including repeated Actions buttons. Audit details inside unsaved
  dialogs and close opened surfaces with Escape.
- Keep the existing Chrome CDP default and CLI disposable/local-host guards.
  Optional Chromium, Firefox and WebKit drivers use an existing Playwright
  runtime. Firefox pointer preferences switch with the touch viewport.
- Measure centered press layers and clipping for the existing 24px spacing
  check; continue reporting targets below the design's 44px separately.
- Wait for actual font readiness before each check.

## Completion Notes

Source checkpoint only: twelve pure synthetic DOM/geometry/CLI regressions pass
with zero skips. They cover freshly inserted nested content, unreachable
summaries, skipped focus targets, missing focus indicators, restoration after
a deliberate failure, host guards and effective touch geometry. The existing
Vitest suite invokes these regressions so CI and test:local include them.
Synthetic key transport is not native-browser evidence.

Actual film, painting and Harmonize checks in all three headless engines,
fixture state comparisons, production/Docker, typecheck, lint, full test:local
and page budgets remain pending the heavy-slot grant. No database, schema,
runtime preference, package manifest, lockfile or product UI change.

Source review correction: a dialog Tab result may report BODY while native
browser chrome owns focus. Accept only BODY with measured
`document.hasFocus() === false`; continue failing focused BODY and background
controls. Three regressions cover those states, and actual browser reports
count only observed instances of the narrow exception. Native evidence is
still pending the heavy-slot grant.

Native Firefox diagnosis: forward Tab can retain the last page control while
Shift+Tab reaches the preceding summary. Reachability now tries bounded
native walks in both directions, without forced focus or broader dialog
exceptions. The failed forward-only trace is retained locally.

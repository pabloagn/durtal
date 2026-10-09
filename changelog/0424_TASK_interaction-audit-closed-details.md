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
The synthetic merge preview reproduces two additional coarse-pointer failures:
the record link is about 36px high and the filled-fields summary about 20px.
Both now have a minimum 44px target on coarse pointers.

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
- Wait for actual font readiness before each check. Independently measure
  actual press geometry and browser hit ownership for reported touch failures.

## Completion Notes

Source checkpoint only: twelve pure synthetic DOM/geometry/CLI regressions pass
with zero skips. They cover freshly inserted nested content, unreachable
summaries, skipped focus targets, missing focus indicators, restoration after
a deliberate failure, host guards and effective touch geometry. The existing
Vitest suite invokes these regressions so CI and test:local include them.
Synthetic key transport is not native-browser evidence.

The historical checkpoint passed 3,451 tests with zero skips, all three Python
suites, typecheck, lint, production build and Docker. Native disclosure,
focus-skip and failure-restoration regressions pass in Chromium, Firefox and
WebKit. WebKit uses a temporary process argument for full keyboard navigation;
no saved macOS or Safari preferences change. Exact final-head gates, actual
application matrix, fixture invariants and artifact binding remain under review.
No schema, package manifest or lockfile change.

Source review correction: a dialog Tab result may report BODY while native
browser chrome owns focus. Accept only BODY with measured
`document.hasFocus() === false`; continue failing focused BODY and background
controls. Three regressions cover those states, and actual browser reports
count only observed instances of the narrow exception. Native evidence is
retained locally for independent evidence review.

Native Firefox diagnosis: forward Tab can retain the last page control while
Shift+Tab reaches the preceding summary. Reachability now tries bounded
native walks in both directions, without forced focus or broader dialog
exceptions. The failed forward-only trace is retained locally.

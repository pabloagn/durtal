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

Source checkpoint only: fifteen pure synthetic DOM/geometry/CLI regressions pass
with zero skips. They cover freshly inserted nested content, unreachable
summaries, skipped focus targets, missing focus indicators, restoration after
a deliberate failure, host guards and effective touch geometry. The existing
Vitest suite invokes these regressions so CI and test:local include them.
Synthetic key transport is not native-browser evidence.

The historical checkpoint passed 3,451 tests with zero skips, all three Python
suites, typecheck, lint, production build and Docker. Native disclosure,
focus-skip and failure-restoration regressions pass in Chromium, Firefox and
WebKit. The explicit macOS WebKit Option-Tab transport includes links;
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

The 375px synthetic film/painting comparison reproduces the same 5px rating
overflow in previous and current artifacts across all three engines. The
identical perfume caller also overflows. On coarse-pointer screens below sm,
only the rating label/control pair now spans the metadata grid, preserving all
five 44px star targets. The book editor already gives the rating its own row;
shared slider behavior and book SSR are unchanged. Firefox desktop capability
flags now combine Fine (2) and Hover (4), while phone mode remains Coarse (1).
Final-head gates and the enlarged caller matrix must be rerun for this checkpoint.

Actual Firefox dialogs initially focus their first field, after the header
controls. Forward Tab can retain the last stop, so the keyboard walk now adds
a bounded reverse pass when expected controls are missing, counting each
identity once. A regression starts a modal in its middle and retains failures
for skipped and ringless controls. Native middle-focus checks pass in all
three engines. The explicit macOS WebKit `WEBKIT_OPTION_TAB=1` transport uses
and reports native Option-Tab traversal to include links without saved preference changes; plain Tab failures are retained
as runtime diagnosis. The unchanged 320px title/action overflow remains an
independent baseline finding (SLN-566), not a clean whole-page result. Final
shipping gates follow stabilization of the actual native caller checks.

Independent source review correction: every native stop in a modal keyboard
walk now uses the strict containment rule before duplicate or BODY filtering.
Focused BODY and background controls retain failures after reverse re-entry;
only measured browser-chrome BODY stops are allowed. The regression also
verifies disclosure, dialog, focus and scroll restoration after that failure.

Native visibility diagnosis: suppressing animations in the focus-ring probe
restarted the real 150ms dialog entrance when its temporary style was removed.
Only transitions are now suppressed. The serial native regression reproduces
the old restart, then verifies unchanged animation count, full opacity, focus
and temporary-style cleanup in Chromium, Firefox and WebKit. It still reports
a deliberately missing ring. Product animation CSS is unchanged.

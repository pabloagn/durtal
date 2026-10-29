# Task 1147: Keep film and publisher image headers within phone gutters

**Status**: Completed
**Created**: 2026-10-29
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: SLN-888

## Overview

Film stills and publisher backgrounds pulled out by 24px inside the shell's
16px phone gutters, making a 390px page scroll 8px sideways.

## Implementation Details

Both header bands now use 16px negative margins below the existing md breakpoint
and retain 24px negative margins above it. Their inner padding follows the same
breakpoint so titles and controls retain the page's text edge. Missing-image
layouts and each page's desktop backdrop treatment are unchanged.

## Completion Notes

- Before: both 390px synthetic pages measured 8px overflow, with backgrounds
  spanning -8px through 398px.
- After: 54 production-mode Chromium, Firefox and WebKit cases covered both page
  types, 320/390/1440px widths, short/long names and absent backgrounds. All image
  edges matched their intended frame; no overflow, alignment or contrast issue.
- The complete local suite passed: all 13 Python suites and all 9,146 tests in
  879 JavaScript/database files, no skips; disposable databases were removed.
- Typecheck, lint and production build passed. Lint retains existing warnings.
- Page weight: 45 routes passed, including all six page fixtures. Nine routes
  without the corresponding synthetic content were explicitly skipped.
- No schema, dependency, data, or AWS infrastructure changes. Merge and live
  deployment are tracked separately in the PR and Linear.

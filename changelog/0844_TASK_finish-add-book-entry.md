# Task 0844: Finish Add-book entry, validation and source feedback

**Status**: Complete
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-947, SLN-949, SLN-950, SLN-951
**Blocks**: None

## Overview

Manual entry goes through duplicate detection before advancing or saving with Fast Track. Required fields and source outcomes are explicit, and step changes preserve a useful keyboard focus target.

## Implementation Details

- Check title and author before every forward/save path, explain missing fields inline and focus the first one.
- Use the existing duplicate matcher for manual entry and Fast Track. An explicit Create as new choice applies only while that precise identity remains unchanged.
- Keep navigation and repeated saves blocked while duplicate detection is pending; retain the draft after a failed check.
- Focus the next step's first useful field/control and an ISBN conflict's field.
- Render completed empty searches, keep manual entry available, and return provider-failure notices scoped to the current request.
- Abort stale searches, avoid cross-request failure leakage, and distinguish an absent ISBN from a failed source.

## Completion Notes

The local harness passed 79 tests, including atomic writes and duplicate-name regressions, with no skips. Production checks cover the four entry/validation cases, empty and failed searches, and all five form steps at 1440/390/320 in Chromium, Firefox and WebKit. Required-field focus was asserted after its scheduled frame. The integrated build and smoke passed after the save-error recovery merged. Lint passed with existing warnings only; page-weight passed on 37 available routes, with eight unseeded routes explicitly skipped. No live catalogue data changed.

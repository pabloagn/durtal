# Task 0870: Select Escape ownership and stable draft values

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: HIGH
**Type**: Fix
**Depends On**: SLN-978 shared surface Escape handling (reviewed main integration pending)
**Blocks**: SLN-930

## Overview

SLN-981: an open Reading Select could let Escape reach its parent dialog after a disabled-option pointer click. Loading the unchanged selected reading's label also looked like an edit to draft tracking and produced an unsaved-changes prompt.

## Implementation Details

- The shared Select owns a child surface lease while its list is open. Escape closes that list and restores its trigger through the existing surface stack, without a competing document key listener.
- Outside clicks and Tab retain their focus destination. Enabled option selection retains the existing trigger focus behavior. Unmounting releases the lease without restoring stale focus.
- Select exposes its controlled value with `data-draft-value`, which the existing draft tracker already prefers over displayed text. Label hydration does not create a draft edit; a real value change still does.
- Mounted tests use an actual FeatureSurface/shared-scope parent Dialog and cover disabled mouse/touch activation, asynchronous label hydration, real value changes and restoration, dirty-parent guards, keyboard activation, outside/Tab focus, newer surfaces and unmounting. Modifier/repeat, IME and native-popover expectations remain strict.

## Completion Notes

Source-only checkpoint from reviewed main 385241a3. Tests, typecheck, production build and native three-engine browser acceptance have not run. The already-reviewed SLN-978 shared modifier/repeat handler must arrive through main ancestry before running these regressions; this change does not duplicate that shared handler patch. Original SLN-930 browser failure evidence remains preserved under `/private/tmp/sln930-grant22c-browser-retry1`.

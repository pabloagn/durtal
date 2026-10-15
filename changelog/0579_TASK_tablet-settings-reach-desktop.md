# Task 0579: A tablet's reader settings reach a desktop that has none

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-686 moved laptops from the tablet class to the desktop class, and a
desktop with no reader settings of its own takes the tablet's, field by
field, so a laptop kept the settings it had saved as a tablet. The settings
rows record only the class that saved them, so a real tablet's settings
reach such a desktop the same way. That is kept on purpose: a desktop with
none starts from the reader's last tablet settings, and its own settings
replace them field by field once it saves any. This task records that
decision in the code and in a test that names the case. SLN-686.

## Implementation Details

- `src/lib/reader/presentation/defaults.ts`: the comment on the carry-over
  says that a real tablet's settings carry over too, and why.
- `src/__tests__/reader/presentation-schema.test.ts`: a new test where only
  a tablet has saved settings. The desktop takes what the tablet saved but
  not the tablet's defaults (edge taps stay off), the desktop's own saved
  fields win once it has some, and the tablet itself is unchanged.

## Completion Notes

- No behaviour change. No migration and no new packages.

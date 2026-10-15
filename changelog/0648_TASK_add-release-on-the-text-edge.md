# Task 0648: "Add release" starts on the text edge; Remove release is 44px on touch

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Third main audit, finding 1 (`findings/audit-3-2026-10-15.md`). In a film's
Add version and Edit version dialogs, the ghost "Add release" button under
the releases sat 10px in from the text above it, in every engine and width.
A ghost button that starts a row under text pulls out by its own padding
(docs/03, Spacing Scale). Measuring the fix found a release's Remove cross
a 24px target on touch.

## Implementation Details

- `src/components/films/version-dialog.tsx`: "Add release" takes `-ml-2.5`,
  its `sm` padding, so its icon starts on the releases' text edge.
- A release's Remove cross is 44px on touch, still on the cap-height center
  of "Release 1" (`CapAligned` with `coarseHeight`).
- Test: `src/__tests__/ui/version-dialog-add-release.test.ts`.

## Completion Notes

- Measured in Add version on a film page, on a production preview of a
  disposable seed database in Chromium, Firefox and WebKit at 1440, 390 and
  320 (touch below 800), with no release and with one:
  - "Add release"'s icon starts on the "Releases" heading's edge (0.00px;
    10px in on main, 9.7px in WebKit at 1440);
  - Remove release is 44 × 44 on touch (24 × 24 on main);
  - alignment, touch and overflow audits are clean.
- `page-weight.js` passes. Typecheck clean, lint no errors, UI tests pass
  (104 files). No migration, no new package.

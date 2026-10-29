# Task 1154: Declare and enforce the supported Node floor (SLN-1257)

**Status**: Completed
**Created**: 2026-10-29
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

PDF inspection and the Calibre SQLite reader require Node 22.13 or later. The package and release gate previously accepted earlier Node 22 versions.

## Implementation Details

package.json declares >=22.13 <23. The Mac preparation/runtime gate rejects earlier versions with an explicit minimum-version message. Tests cover rejected 22.0, 22.12, other major versions, and accepted 22.13/22.23.3, plus agreement with the package declaration.

## Completion Notes

No dependency versions or lockfile change. All 13 Python suites passed, including floor refusal/acceptance checks. Typecheck, lint and the production build passed with the existing pinned Node 22.23.3 toolchain. Deployment remains tracked in Linear.

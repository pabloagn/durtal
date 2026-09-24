# Task 0098: Add Missing "contributor" to EDITION_CONTRIBUTOR_ROLES

**Status**: Completed
**Created**: 2026-04-06
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0097
**Blocks**: None

## Overview
The `EDITION_CONTRIBUTOR_ROLES` array in `src/lib/types/index.ts` is missing the `"contributor"` role that is documented in `docs/02_DATA_MODEL.md` line 368. The documentation lists 10 roles; the code has only 9.

## Implementation Details
- Add `"contributor"` to `EDITION_CONTRIBUTOR_ROLES` in `src/lib/types/index.ts` line 134
- Verify the edition_contributors DB table can store this value (text column, no enum constraint — should be fine)
- Update any UI dropdowns that render contributor role options to include "contributor"

## Test Evidence
- `src/__tests__/types/enums.test.ts` — "contains all documented roles including contributor" FAILED
- `src/__tests__/cross-layer/spec-compliance.test.ts` — "EDITION_CONTRIBUTOR_ROLES count should be 10" FAILED (got 9)

# Task 0326: The Works API Sets and Clears a Rating

**Status**: Completed
**Created**: 2026-10-05
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: The clean-up of 47 seed ratings

## Overview

Joris approved clearing the star rating on 47 unread seed books whose rating only repeats their buying priority. Catalogue changes go through the REST API, never direct SQL, and `PATCH /api/works/[id]` could not change a rating: only the library's bulk toolbar could, through a server action. The route now takes a rating.

## Implementation Details

- `src/app/api/works/[id]/route.ts`: the body accepts `rating`, an integer from 1 to 5 or `null` to clear it. It goes through the same `updateWork` as the Edit dialog and the bulk toolbar, so the activity log records it. The response includes `rating`. A rating out of range, or not a whole number, answers 400 and writes nothing.
- `docs/05_API_REFERENCE.md`: the field and the response.
- Half-star ratings (SLN-446) will widen the check to steps of 0.5.

## Completion Notes

- `src/__tests__/integration/rest-write-routes.test.ts`: sets 4, clears with `null`, refuses 6 and 2.5.
- `pnpm typecheck` clean; `pnpm lint` 0 errors; the REST write-route suite 22 of 22 (`scripts/qa/test-local.py rest-write-routes`).

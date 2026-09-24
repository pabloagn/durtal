# Task 0106: Add Global and Segment Error Boundaries

**Status**: Completed
**Created**: 2026-04-06
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0097
**Blocks**: None

## Overview
No `error.tsx` files exist in the application. Unhandled server errors crash the page with Next.js default error UI instead of a styled error page matching the design language.

## Implementation Details
- Create `src/app/error.tsx` — global error boundary with retry button
- Create segment-level error boundaries for heavy data pages:
  - `src/app/library/error.tsx`
  - `src/app/authors/error.tsx`
  - `src/app/provenance/error.tsx`
- Create `src/app/not-found.tsx` — styled 404 page
- All error pages must use the gothic-minimal design language (dark bg, serif heading, muted text)
- Include "Go back" and "Try again" actions

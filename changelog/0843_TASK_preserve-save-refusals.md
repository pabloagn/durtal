# Task 0843: Preserve expected save refusals and recovery feedback

**Status**: In Progress
**Created**: 2026-10-16
**Priority**: HIGH
**Type**: Fix
**Depends On**: SLN-942, SLN-909
**Blocks**: SLN-957

## Overview

Return intentional catalogue write refusals as data across the UI server-action boundary. Keep unexpected exceptions protected by Next.js. Normalize browser connection errors and replace a write's earlier failure when its retry succeeds.

## Implementation Details

- Mark deliberate business refusals explicitly; convert known database rule and validation failures to a discriminated UI result. Preserve existing service and API return contracts.
- Route version, art object, formulation, retailer, acquisition and reading writes through the shared UI adapters.
- Normalize Chromium, Firefox and WebKit connection messages centrally, including pending-operation outcomes.
- Scope retry feedback by action and record in person, publisher, film version, art object and formulation forms; unrelated failures remain visible.
- Align the error toast dismiss control with its first text line; the three-browser audit found the old corner offset beside wrapped errors.
- Validate blank publisher names inline before sending a request.
- Exercise helper failure classification, notification lifecycle and real duplicate refusals against disposable databases.

## Completion Notes

Validation in progress. No live catalogue writes, migrations, ingestion or deployment.

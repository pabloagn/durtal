# Task 1157: Match the TUI's default API address to task dev (SLN-1273)

**Status**: Completed
**Created**: 2026-10-29
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

The terminal client defaulted to port 3003, where Durtal does not run. Its default is now http://localhost:3100, matching task dev.

## Implementation Details

The client, environment example and configuration/TUI guides use the same default. Environment and explicit constructor overrides still work; the guide explains the separate live release on 3110. No existing environment file was edited.

## Completion Notes

Two isolated Python tests cover the default health request, overrides and cleanup. The actual client, with environment-file loading disabled for this check, reached the existing development server at its new default and returned healthy. Ruff passed. All 14 Python suites passed. The full JavaScript suite passed 9,165 cases; its documentation-policy failure was corrected and all 3 focused policy cases then passed. Typecheck and affected-file lint passed. The final full CI run remains the merge gate.

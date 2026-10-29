# Task 1156: Align a wrapped publisher Restore action (SLN-1186 follow-up)

**Status**: Completed
**Created**: 2026-10-29
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: Task 1149
**Blocks**: None

## Overview

Live verification of the empty-state release found a 10px Restore-button indent in the populated publisher-review list at 320px, in all three browsers.

## Implementation Details

The ghost button pulls out by its horizontal padding, so its icon aligns with the text column when it wraps. The row and button action are unchanged.

## Completion Notes

The full 9,166-test suite passed. Twelve Chromium/Firefox/WebKit checks at 320/390/768/1440, with short and wrapping ignored names, passed alignment, contrast and overflow audits. Typecheck, lint, build and all 39 populated page-weight routes passed (9 fixture skips). SLN-1186 remains open until this follow-up is deployed and verified.

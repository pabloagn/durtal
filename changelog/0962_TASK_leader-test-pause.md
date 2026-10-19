# Task 0962: The leader menu pointer test pauses after its pick

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0956, 0957
**Blocks**: None

## Overview

Main's Tests job failed from 49fb6a3f on. `leader-menu-focus.test.ts`, "starts on its first item under a resting pointer, and follows a moving one" (SLN-1189, #543), presses G, Enter, then G again in the same instant. Since #545 (SLN-1190), a key that follows a pick by less than 350 ms is the rest of a typed word and is dropped, so the second G opened no menu and `items()[3]` was undefined.

## Implementation Details

The settle window is right: it is what keeps "nandu" from making a person "du", and docs/15 says keys after a pause act as ever. The test was wrong to press the second G with no time after the pick. It now holds `performance.now` on a clock it controls and moves it on by a second before the second G, as a person's pause would. Nothing in the app changes.

## Completion Notes

- The test failed 3 of 3 on main and passes 3 of 3 with the pause; all 204 UI test files pass.

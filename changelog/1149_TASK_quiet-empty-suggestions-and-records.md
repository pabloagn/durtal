# Task 1149: Quiet empty suggestions and records

**Status**: Completed
**Created**: 2026-10-29
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: SLN-1186

## Overview

Empty Suggestions no longer shows filters, zero-count sections or a disabled
Pick one for me. Publisher-name review says the empty result once. A person
without credits says so and explains where to add a credit.

## Implementation Details

Suggestions uses its existing candidate, hidden and re-read lists to keep useful
controls when any of those are available, and otherwise shows one empty view.
Publisher review omits its numerical summary when there are no names to review.
The person page checks book, edition and other collection credits; the empty
line also appears for a biography-only person and disappears when credited.

## Completion Notes

The complete local suite passed: 13 Python suites and 9,146 JavaScript/database
tests in 879 files, no skips. Typecheck, lint and production build passed.
Production-mode Chromium, Firefox and WebKit at 320/390/1440px verified empty
Suggestions, empty publisher review, people with and without a biography, and
populated suggestions/person pages. The combined SLN-1052/1186 matrix has 90
scenarios with no measured alignment, contrast or overflow failures. All 45
populated-fixture page-weight routes passed; seven unpopulated fixture routes
were skipped. No data, schema or dependency changes. CI, merge and deployment
are tracked separately in Linear and the PR.

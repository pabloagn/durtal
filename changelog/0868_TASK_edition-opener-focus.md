# Task 0868: Restore the Edit edition opener in WebKit

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-979
**Blocks**: None

## Overview

A pointer-opened Edit edition dialog leaves focus on the page body after it closes in WebKit. This also reproduces without opening a calendar on pre-calendar source 50cf0a5, and on f57d6f2 and 7d12b52. Keyboard activation returns focus correctly.

## Implementation Details

- Focus the actual Edit edition button in its click handler before opening the form, so the existing dialog captures its opener in Safari.
- Keep shared Button, Dialog, surface ownership, nested/newer focus and unsaved-work rules unchanged. Only the edition opener changes.
- Add mounted caller regression coverage for a pointer click that starts with body focused, an already-focused keyboard opener, and Keep editing/Discard after a changed draft.

## Completion Notes

Source prepared only. Tests, typecheck, production build and browser acceptance remain pending a separate grant. Preserved baseline and candidate browser evidence: /private/tmp/calendar-grant15c2/combined-summary.json and focus-precalendar/report/report.json. No deployment or live data changes.

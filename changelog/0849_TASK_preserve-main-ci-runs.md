# Task 0849: Let main CI runs finish

**Status**: In Review
**Created**: 2026-10-17
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: Finished main CI evidence

## Overview

SLN-866: frequent merges cancelled the database run already in progress on main.

## Implementation Details

Pull-request runs retain a ref-specific concurrency group and cancel their
predecessor. Main and tag pushes use the unique workflow run ID and do not cancel a running
predecessor, so successive commits can finish independently. All lint, type,
database and Docker jobs remain unchanged.

## Completion Notes

Source review confirms distinct groups for successive push runs and the same
group for updates to one PR. No application code, test filtering or job ordering
changed. Hosted evidence of two main runs finishing and an old PR run cancelling
requires the workflow to land; SLN-866 remains open until those criteria are met.
No heavy local suite was started while the shared validation slot was reserved.

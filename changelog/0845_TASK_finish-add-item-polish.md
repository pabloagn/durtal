# Task 0845: Finish Add-item notices and keyboard polish

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-948, SLN-952
**Blocks**: None

## Overview

Advise about same-name records without blocking intentional additions, and complete the remaining Add-flow keyboard and presentation acceptance items.

## Implementation Details

- Add small exact-name lookups, normalized for accents and case, and advisory notices for perfume, painting, publisher, person, organization, series and collection. Preserve the existing richer film notice.
- Keep stale name lookups out of current results and leave Save available.
- Use cover-letter fallbacks for wizard matches/results, identify ISBN matches correctly and show the duplicate step in its actual position.
- One Escape exits a clean, idle book search; open results still close first. Draft-loss prompts start on Keep editing.
- Add organizations to A O, the N menu, shortcut help and palette via the shared registry.
- Use the existing checkbox treatment, sentence-case date labels, consistent Add collection wording, and explicit missing-name hints.

## Completion Notes

Implementation and validation in progress. No deployment or live catalogue writes.

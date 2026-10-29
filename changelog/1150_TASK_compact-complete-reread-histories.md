# Task 1150: Compact, complete re-read histories (SLN-998)

**Status**: Completed
**Created**: 2026-10-29
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: SLN-930 acceptance

## Overview

Keep long Most re-read histories within the page while preserving every saved value and the full book title.

## Implementation Details

The shared RatingHistory renders short histories inline. Histories longer than six entries show the first three and an explicitly named native disclosure containing the complete ordered list. Titles wrap fully. Stored rating values are never rounded; no schema or NumberTiles changes are involved.

## Completion Notes

All 9,150 tests and 13 Python suites passed, as did typecheck, lint and the production build. Synthetic production-mode fixtures cover 278 entries, short/mixed/null and absent histories at 320/390/430/768/1440 in Chromium, Firefox and WebKit, with keyboard and touch disclosure checks and zero alignment, contrast or page overflow failures. Page-weight checks passed all 40 populated routes (8 empty-fixture skips).

The original temporary NumberTiles evidence files are no longer present. A documented 278-entry fixture was recreated: unchanged prior source stretched 320px to 5,765px. This verifies the current fix, not a byte-identical rerun of the missing original matrix. SLN-930 remains separate and open. Deployment is tracked in Linear.

# Task 0867: Bound reading aggregate work and year previews

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: HIGH
**Type**: Fix
**Depends On**: SLN-930 bounded reading surfaces (0866)
**Blocks**: None

## Overview

SLN-930's remaining statistics/year/journal slice. Statistics previously repeated a per-reading finished-count lookup for effective ratings. The year review fetched every finished reading and its cover before showing only twelve per month. Journal rows and totals repeated the same global facts and computed full-row fingerprints before paging.

## Implementation Details

- Add narrow all-history reading facts. One partition count supplies sole-finished rating fallback; existing ordinal and re-read windows still precede filters. Review bodies, JSON and mutation fingerprints stay out of the facts relation.
- Use those facts in statistics and journal queries. Keep counted pages, positions, running-timer rules, goals, existing batching, and the complete ratings display unchanged.
- Select up to twelve year covers per month, with exact month counts and independent first/last/longest/highest-rated/most-re-read picks. Hydrate covers only for selected rows. Keep global counts, precision handling, ordering and the favourite passage.
- Return a journal's exact summary and bounded page in one statement. Hydrate selected rows' metadata and full-row fingerprints after paging. Preserve filter/sort/export scope and the existing row API.
- Extend real-database regressions for global rating fallback, late-page ordinals and fingerprints, empty/out-of-range pages, full exports, highlights outside the preview, year-only counts and cross-year/positionless session arithmetic.

## Completion Notes

Based on PR484 commit `d2440b83e14a0045761d05cb869fd40c066b5c7a`. The first validation run and pending correction are recorded below. No build, browser or performance benchmark has run for this slice. The 1,000/5,000-reading, 40/200ms transport and unchanged page-weight acceptance remain pending, as do native visual checks. No performance improvement or whole-ticket completion is claimed.

### Validation checkpoint and null-preserving history transport

At `6a570faf`, full typecheck passed and 54 of 55 selected tests passed with zero skips. The new null-rating case exposed the local PostgreSQL adapter decoding null elements in `float8[]` as `NaN`. The full ordered history now uses `jsonb_agg`, preserving every numeric or null value and its order through both adapters. The strict `[null, 4, null]` assertion is unchanged. The failed run and diagnosis remain preserved under `/private/tmp/sln930-0867-validation-r1`; this transport correction has not yet been run through validation.

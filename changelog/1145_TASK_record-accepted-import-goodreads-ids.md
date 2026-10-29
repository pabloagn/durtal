# Task 1145: Record Goodreads IDs on accepted imports

**Status**: In Progress
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: SLN-1082, SLN-1090
**Blocks**: SLN-1090

## Overview

Keep Commit available for an already accepted import row when recording its missing Goodreads ID is the only remaining action.

## Implementation Details

- Include the existing eligible-ID preview count in button availability and say “Record” for an ID-only action.
- Return actual inserted IDs from the locked atomic claim and ownership journal; reused IDs count as zero.
- Preserve accepted-row eligibility, default decisions, matching, reading writes and guarded Undo. No automatic backfill.
- Show actual new-ID counts in the result without adding zero-reading noise; historical restore results report zero new Goodreads IDs.

## Completion Notes

Focused availability, result-count, duplicate/concurrent claims, retry and ownership regressions are prepared. Runtime validation remains pending.


## Verification update — 29 October 2026

Recovered in PR #637 on current main. Typecheck, lint and the production build
passed with the pinned Node 22 runtime. All 9,146 JavaScript/database tests in
879 files passed against disposable PostgreSQL; full Python/CI validation is
tracked separately by the PR checks and must pass before landing.

Production-mode acceptance used only a disposable catalogue: all 32 empty
native exports and all 32 populated exports returned files; the 16 empty
CSV/TSV imports returned no-op results. An independent PyArrow reader verified
stable schemas and exact JSON/Parquet values for all eight entities. Forty
additional synthetic Arrow cases covered empty, null, full, mixed and reordered
records, including nested structures, BCE dates and exact microsecond instants.
Thirty readings, thirty sessions and thirty notes restored through the browser
with all exported values preserved; Undo removed exactly the restored records.
Thirty-six Chromium, Firefox and WebKit scenarios at 390 and 1440 pixels passed;
measured alignment, contrast, control names and overflow checks had no failures.
Forty-two configured routes passed page-weight budgets; six routes without
corresponding synthetic e-book/taxonomy fixtures were explicitly skipped.

SLN-1183 is only partially addressed: empty Goodreads/JSON/Parquet import
acceptance still needs work. No claim of complete all-format import support,
merge, deployment or owner-phone acceptance is made by this verification update.

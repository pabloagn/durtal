# Task 0152: Normalize book series and show ordered sibling works

**Status**: Completed
**Created**: 2026-09-29
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0143 (series management)
**Blocks**: None

## Overview

SLN-331 follow-up: book saves stored a series name without creating or linking a series record. This left On the Calculation of Volume absent from the Series directory and its book metadata unlinked.

## Implementation Details

- Normal creation, Fast Track and book updates resolve a typed series name to a real series ID. Exact matching ignores case and repeated whitespace; it does not infer membership from book titles. Advisory locking prevents concurrent book saves from creating duplicate series. Resolution and the work write commit together; Fast Track also rolls the series back if its edition/copy transaction fails.
- Both book editors offer existing series and inline creation. Position accepts integer or decimal values. Clearing membership also clears obsolete text and position. Library search follows normalized series titles.
- Book pages show a linked series and a shared carousel of other members, ordered numerically with unspecified positions last. The current work is excluded and each card shows its position. The heading links to the series page.
- Series row controls use cap-height alignment with titles. No schema migration, dependency or broad data backfill.

## Completion Notes

- Regression suite: 469 passed, 92 skipped (unconfigured unrelated integration suites); both Series and Fast Track PostgreSQL suites enabled against isolated local databases.
- Typecheck, ESLint and production compilation pass. Combined typecheck with existing uncommitted author-picker work passes.
- Browser verified new-series creation in both book editors, directory visibility, navigation and numeric carousel order (1, 2.5, 3, 10 while viewing volume 2).
- Repository alignment audit: no deviations >0.5px. Book page 21 checks; full editor 28; library 26; quick editor 33; series detail 18; directory 24.
- Live repair is restricted to the three books already explicitly named On the Calculation of Volume, preserving their recorded positions 1, 2 and 3. A full-row backup and transaction guards protect intervening edits; every non-series value is compared before commit. Unrelated author-picker source changes remain uncommitted and are preserved during activation.

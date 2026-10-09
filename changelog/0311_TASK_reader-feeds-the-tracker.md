# Task 0311: SLN-454 — Reader feeds the tracker

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-450, SLN-451, SLN-452, SLN-453, SLN-490, SLN-492, SLN-493, SLN-500
**Blocks**: SLN-459

## Overview

The reader will feed tracker sittings, counted progress, explicit finish and
linked quotes. Legacy history will have a persistent preview, commit and undo.
Only isolated pure policies are implemented at this checkpoint, on reviewed
reader source `626f4870`. Services, plugin/UI, schema and deployment remain gated.

## Implementation Details

- `active-time.ts`: monotonic, event-driven visible active-time accounting;
  five-minute activity window, thirty-minute idle end, short hidden continuation,
  explicit close and one next deadline. No DOM, timers, I/O or polling.
- `reader-position.ts`: constant-space counted location reducer; turns, jumps
  qualified by two active minutes or reading onward, backwards segment splits,
  preserved furthest progress and a counted end gate.
- `reader-progress.ts` and `ebook-backfill.ts`: fractional legacy conversion,
  end threshold, Unicode chapter cutting and every legacy proposal/default rule.
  Dates use injected application-zone reading days. No finish date is invented.
- `validations/reader-tracking.ts`: proposed strict sitting transport with original
  reading binding, monotonic revision, bounded active time/body, zone validation,
  chapter cutting and database percentage precision. Not wired to a route yet.
- `reader-receipts.ts`: pure cumulative-flush/idempotency policy; immutable owner
  binding, replay rejection, retired receipt protection and protected merge rules.
  A receipt survives session deletion in the proposed schema; no migration yet.

## Completion Notes

Focused verification: four pure-policy test files, 63 tests passed, zero skipped.
Targeted TypeScript check of those files and their pure imports passed. ESLint on
the six new source modules passed with zero warnings; tests are excluded by the
repository's existing lint configuration. The repository-wide typecheck remains
part of the later integration gate, not claimed by the focused check.

This is not feature completion. Native/browser acceptance, DB tests, full zero-skip
suite, default Mac dev, builds, Docker, CI, migration rehearsal and deployment
have not run. The primary checkout, manual port 3100 and live data are untouched.
Dependencies are reused through a worktree-local symlink; none were installed.

Migration `0087_reader_tracker_integration` is reserved but not generated. Exact
legacy preservation/receipt schema and annotation deletion composition need root
review. Main's applied 0075/0076 checked old history was empty and dropped it;
`legacy_reader_progress` is not present and must be supplied additively. An empty
live backfill is valid evidence of no old rows, not synthetic feature acceptance.

SLN-450's import recovery correction is on main. Its remaining recorded acceptance
is the real spreadsheet run against a dump-backed preview and recorded mappings
and counts. Reader-specific import branching and operation ownership remain work
for this integration; they are not claimed as existing SLN-450 functionality.

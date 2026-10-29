# Task 1141: Restore Durtal reading history

**Status**: In Progress
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: SLN-1082, SLN-1369
**Blocks**: SLN-1090, SLN-1183

## Overview

Restore Durtal readings, sessions, quotes and notes through the existing import preview, with truthful empty-file handling and preservation of existing edits and current progress.

## Implementation Details

- All eight known current/legacy header families succeed as empty no-ops before persistence or S3.
- Version 3 extends only reading, session and note export contracts; frozen v2 definitions and recognition remain. Original baseline, source references, counters, rich thoughts and microsecond instants are carried explicitly.
- Restore resolves exact parent IDs, source keys or verified durable mappings. Same-date/title heuristics never prove parents; explicit wrong-parent IDs are refused.
- Bounded transactions revalidate parents after locks, insert records, and journal actual ownership atomically. Existing rows are preserved. Undo checks full snapshots and effective parent ownership.
- Historical sessions never recompute or advance current progress. Counted-page ordering includes the existing ID tie-breaker for deterministic equal-time histories.
- Bounded HTML/JSON validation and rendering use the existing sanitizer and editor extensions, with matching support enabled on the note editor. Legacy absent rich columns have an escaped plain-text fallback. Invalid dates, NULs and lone surrogates become refused rows.
- Every batch and final completion revalidate the initial restore generation; Undo rotates it atomically. Both paths use UTC snapshots and preserve unrelated JSON journal fields.
- Existing Goodreads claims, private-note import, rating and queue paths remain available independently.

## Completion Notes

Source and focused unit/API/disposable-database regressions prepared, including 30-book same-install imports, fresh IDs, baseline totals, microseconds, edition switches, duration-only history, concurrent commit, interrupted retry, and safe undo. Runtime, independent review, full local suite and rendered UI verification are pending; no tests or build run for this phase yet.


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

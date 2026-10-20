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

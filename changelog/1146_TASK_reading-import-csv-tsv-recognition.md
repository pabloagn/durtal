# Task 1146: Reading import CSV and TSV recognition

**Status**: In Progress
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: SLN-1082
**Blocks**: SLN-894

## Overview

SLN-1090 Phase 1 accepts reading-history CSV and TSV and identifies the app’s eight table exports truthfully. Session/note writing and restoration remain a later phase.

## Implementation Details

Shared header declarations move to the pure export columns module; schema exports retain their existing names and values. Header-based detection identifies catalogue, session and note files without labelling them foreign exports or promising an unavailable restore path.

The delimited reader handles BOM, quoted delimiters/newlines, doubled quotes and CRLF/LF. Malformed quotes, duplicate/empty headers and excess cells are refused. Upload controls accept CSV/TSV and retain the existing size, origin and empty-file checks. Raw-file storage uses the detected delimiter’s MIME type.

Raw parsing preserves apostrophes. Recognized Durtal reading files keep legacy formula-guard decoding; third-party files do not have authored apostrophes stripped. The legacy Durtal escape ambiguity requires a later versioned fidelity change.

## Completion Notes

Root and independent PM source review passed. Typecheck and all 149 tests across ten complete focused unit/API files passed; independent cleanup confirmed no remaining owned processes or resources and unchanged source/protected inputs. UI alignment/page-weight checks, the full test:local gate, and Phase 2 session/note restoration remain pending. SLN-1369 separately owns lossless TSV export fidelity. SLN-1090 remains In Progress. No store, claim, identifier, database schema, package or session/note writer changes.


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

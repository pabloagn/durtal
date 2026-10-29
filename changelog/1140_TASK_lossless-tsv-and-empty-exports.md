# Task 1140: Lossless TSV and empty exports

**Status**: In Progress
**Created**: 2026-10-20
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-1090 Phase 1, SLN-1082
**Blocks**: SLN-1090 restore acceptance

## Overview

SLN-1369 and the export/API portion of SLN-1183: preserve tabs, CR/LF and quotes in TSV, and return meaningful empty files for every supported whole-entity export.

## Implementation Details

TSV now quotes special cells and doubles embedded quotes, retaining its BOM and existing formula guard. CSV serialization is unchanged. The Phase 1 delimited parser reads the quoted output; no lossy-format legend is added.

Whole-entity CSV/TSV downloads use explicit headers even with zero rows. Existing empty JSON arrays and Parquet schemas remain intact. Unknown selected catalogue IDs still return 404 with a neutral message; malformed request bodies return 400. Empty commonplace Markdown has its heading and one clear sentence.

## Completion Notes

Source checkpoint only; tests are prepared but have not run. The matrix covers all eight native entities in CSV/TSV/JSON/Parquet, Goodreads CSV, empty Markdown, missing selected IDs and invalid requests. Lossless TSV round trips use the Phase 1 parser.

SLN-1183 remains In Progress: empty import/no-op criteria require SLN-1090 Phase 2. No store, payload/claim types, ID handlers, package, database schema or provider changes. No runtime, build or commit in this slice.


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

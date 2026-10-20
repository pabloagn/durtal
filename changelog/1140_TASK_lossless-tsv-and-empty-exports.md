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
